#!/usr/bin/env python3
"""Convert a prevalidated Shapefile ZIP to GeoJSON via pyproj, refusing ballpark operations.

Input: ZIP bytes on stdin. Output: JSON on stdout. No filesystem extraction.
Node performs an earlier ZIP central-directory safety scan; this helper repeats size
and naming checks before reading any member (defense in depth).
"""
import io
import json
import math
import sys
import zipfile
from pathlib import PurePosixPath

MAX_ZIP = 12_000_000
MAX_EXPANDED = 64_000_000
MAX_FEATURES = 100_000
MAX_RESULT = 40_000_000
EPSG_MACAO_GRID = 8433


def fail(message):
    raise ValueError(message)


def is_macao_grid(crs):
    """Check an incomplete .prj against the EPSG:8433 projection fingerprint."""
    if not crs.is_projected:
        return False
    datum_name = (crs.datum.name if crs.datum else "").lower()
    full_name = crs.name.lower()
    if not (("macao" in datum_name or "macau" in datum_name or
             "macao" in full_name or "macau" in full_name)):
        return False
    try:
        ell = crs.ellipsoid
        if abs(ell.semi_major_metre - 6378388) > 0.1 or abs(ell.inverse_flattening - 297) > 0.0001:
            return False
        op = crs.coordinate_operation
        if not op or "transverse mercator" not in op.method_name.lower():
            return False
        values = {p.name.lower(): p.value for p in op.params}
        names = {
            "lat": ("latitude of natural origin", "latitude of origin"),
            "lon": ("longitude of natural origin", "central meridian"),
            "scale": ("scale factor at natural origin", "scale factor"),
            "east": ("false easting",),
            "north": ("false northing",),
        }
        expected = {"lat": 22.2123972222222, "lon": 113.536469444444,
                    "scale": 1.0, "east": 20000.0, "north": 20000.0}
        for key, opts in names.items():
            actual = next((values[name] for name in opts if name in values), None)
            if actual is None or abs(actual - expected[key]) > (0.000001 if key in ("lat", "lon", "scale") else 0.01):
                return False
        return True
    except Exception:
        return False


def pick_transformer(raw_wkt, declared):
    from pyproj import CRS
    from pyproj.transformer import TransformerGroup

    if raw_wkt:
        source = CRS.from_wkt(raw_wkt)
        if is_macao_grid(source):
            # A sparse D_Macau .prj is NOT an authority for the datum shift.
            # Override with EPSG:8433 only after matching the projection fingerprint.
            source = CRS.from_epsg(EPSG_MACAO_GRID)
            expected_macao = True
        else:
            expected_macao = False
    elif declared == "EPSG:4326":
        source = CRS.from_epsg(4326)
        expected_macao = False
    else:
        fail("CRS_REQUIRED: Missing .prj; only explicit EPSG:4326 is supported")

    target = CRS.from_epsg(4326)
    if source == target:
        return None, {"sourceCrs": "EPSG:4326", "targetCrs": "EPSG:4326",
                      "operation": "identity", "operationEpsg": None,
                      "accuracyMeters": 0, "ballpark": False}

    group = TransformerGroup(source, target, always_xy=True, allow_ballpark=False)
    candidates = group.transformers
    if expected_macao:
        candidates = [t for t in candidates if
                      "Macao 1920 to WGS 84 (1)" in t.description and
                      0 <= t.accuracy <= 1.1]
    else:
        candidates = [t for t in candidates if t.accuracy >= 0 and
                      "ballpark" not in t.description.lower()]

    if not candidates:
        fail("DATUM_TRANSFORM_UNAVAILABLE: No verified non-ballpark transform to EPSG:4326 (for Macao Grid require EPSG:8438)")

    transformer = candidates[0]
    return transformer, {
        "sourceCrs": f"EPSG:{source.to_epsg()}" if source.to_epsg() else source.name,
        "targetCrs": "EPSG:4326",
        "operation": transformer.description,
        "operationEpsg": "EPSG:8438" if expected_macao else None,
        "accuracyMeters": transformer.accuracy,
        "ballpark": False,
    }


def transform_geometry(geometry, transformer):
    if not geometry:
        return None
    kind = geometry.get("type")
    if kind == "GeometryCollection":
        return {"type": "GeometryCollection",
                "geometries": [transform_geometry(g, transformer) for g in geometry.get("geometries", [])]}

    def walk(coords):
        if isinstance(coords, (list, tuple)) and len(coords) >= 2 and isinstance(coords[0], (int, float)):
            x, y = float(coords[0]), float(coords[1])
            if transformer:
                x, y = transformer.transform(x, y, errcheck=True)
            if not math.isfinite(x) or not math.isfinite(y) or not (-180 <= x <= 180 and -90 <= y <= 90):
                fail("PROJECTION_INVALID: Resulting coordinates are not valid WGS84 longitude/latitude")
            return [x, y] + [float(v) for v in coords[2:]]
        if not isinstance(coords, (list, tuple)):
            fail("INVALID_GEOMETRY: Unexpected coordinate array")
        return [walk(item) for item in coords]

    if "coordinates" not in geometry:
        fail("INVALID_GEOMETRY: No coordinates")
    return {"type": kind, "coordinates": walk(geometry["coordinates"])}


def main():
    try:
        import shapefile
        import pyproj  # noqa: F401
    except ImportError as exc:
        fail(f"PYTHON_DEPENDENCY_REQUIRED: install pyproj pyshp ({exc})")

    declared = sys.argv[1] if len(sys.argv) > 1 else ""
    contents = sys.stdin.buffer.read(MAX_ZIP + 1)
    if len(contents) > MAX_ZIP:
        fail("ZIP_SIZE_LIMIT: compressed ZIP larger than 12 MB")

    archive = zipfile.ZipFile(io.BytesIO(contents))
    groups = {}
    total = 0
    for member in archive.infolist():
        if member.is_dir():
            continue
        name = member.filename
        if name.startswith("/") or chr(92) in name or ".." in name or chr(0) in name:
            fail("INVALID_ZIP: unsafe member path")
        if member.file_size > 32_000_000:
            fail("ZIP_BOMB: member is too large")
        total += member.file_size
        if total > MAX_EXPANDED:
            fail("ZIP_BOMB: expanded archive too large")
        extension = PurePosixPath(name).suffix.lower()
        if extension in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
            stem = name[:-len(extension)].lower()
            groups.setdefault(stem, {})[extension] = member

    layers, transformations, count = [], [], 0
    for stem, files in groups.items():
        if ".shp" not in files or ".dbf" not in files:
            continue
        wkt = (archive.read(files[".prj"]).decode("utf-8-sig", "replace").strip()
               if ".prj" in files else None)
        transformer, metadata = pick_transformer(wkt, declared)
        encoding = (archive.read(files[".cpg"]).decode("ascii", "replace").strip()
                    if ".cpg" in files else "utf-8")
        shape_parts = {"shp": io.BytesIO(archive.read(files[".shp"])),
                       "dbf": io.BytesIO(archive.read(files[".dbf"]))}
        if ".shx" in files:
            shape_parts["shx"] = io.BytesIO(archive.read(files[".shx"]))
        with shapefile.Reader(**shape_parts, encoding=encoding, encodingErrors="replace") as reader:
            features = []
            for record in reader.iterShapeRecords():
                count += 1
                if count > MAX_FEATURES:
                    fail("FEATURE_LIMIT: more than 100000 features")
                geometry = (transform_geometry(record.shape.__geo_interface__, transformer)
                            if record.shape.shapeType != 0 else None)
                features.append({"type": "Feature", "geometry": geometry,
                                 "properties": record.record.as_dict()})
        layers.append({"type": "FeatureCollection",
                       "fileName": stem[:120], "features": features})
        transformations.append({"layer": stem, **metadata})

    if not layers or not count:
        fail("EMPTY_GEOMETRY: no Shapefile features")
    output = json.dumps({"layers": layers, "transformations": transformations},
                        default=str, ensure_ascii=False, allow_nan=False)
    if len(output.encode("utf-8")) > MAX_RESULT:
        fail("OUTPUT_TOO_LARGE: parsed GeoJSON exceeds 40 MB")
    sys.stdout.write(output)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stderr.write(f"{type(exc).__name__}: {exc}" + chr(10))
        sys.exit(2)
