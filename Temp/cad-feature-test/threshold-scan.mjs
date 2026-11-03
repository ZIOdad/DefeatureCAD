import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const runtimeDir = process.argv[2];
const inputFile = process.argv[3];
const thresholds = (process.argv[4] ?? "0.5,1,2,3,5,10,20")
  .split(",")
  .map(Number);

const opencascade = require(path.join(runtimeDir, "oc.cjs"));
const oc = await new opencascade({
  wasmBinary: fs.readFileSync(path.join(runtimeDir, "opencascade.wasm.wasm")),
});

oc.FS.writeFile("/input.stp", fs.readFileSync(inputFile));
const reader = new oc.STEPControl_Reader_1();
reader.ReadFile("/input.stp");
reader.TransferRoots();
const shape = reader.OneShape();

const surfaceNames = {};
for (const key of Object.keys(oc.GeomAbs_SurfaceType)) {
  const value = oc.GeomAbs_SurfaceType[key];
  if (value?.value !== undefined) {
    surfaceNames[value.value] = key.replace("GeomAbs_", "");
  }
}

const faces = [];
const explorer = new oc.TopExp_Explorer_2(
  shape,
  oc.TopAbs_ShapeEnum.TopAbs_FACE,
  oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
);
while (explorer.More()) {
  const face = oc.TopoDS.Face_1(explorer.Current());
  const surface = new oc.BRepAdaptor_Surface_2(face, true);
  const areaProperties = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(face, areaProperties, false, false);
  const linearProperties = new oc.GProp_GProps_1();
  oc.BRepGProp.LinearProperties(face, linearProperties, false, false);
  const area = areaProperties.Mass();
  const perimeter = linearProperties.Mass();
  faces.push({
    type: surfaceNames[surface.GetType().value] ?? "Unknown",
    area,
    width: perimeter > 0 ? (2 * area) / perimeter : 0,
  });
  explorer.Next();
}

const supported = new Set(["Plane", "Cylinder"]);
for (const threshold of thresholds) {
  const big = faces.filter((face) => face.width >= threshold);
  const counts = Object.fromEntries(
    [...new Set(big.map((face) => face.type))]
      .sort()
      .map((type) => [type, big.filter((face) => face.type === type).length]),
  );
  const unsupported = big.filter((face) => !supported.has(face.type));
  console.log(JSON.stringify({
    threshold,
    bigFaces: big.length,
    unsupportedBigFaces: unsupported.length,
    counts,
  }));
}

console.log("largest unsupported faces");
for (const face of faces
  .filter((candidate) => !supported.has(candidate.type))
  .sort((left, right) => right.width - left.width)
  .slice(0, 20)) {
  console.log(
    `${face.type.padEnd(18)} width=${face.width.toFixed(3)} area=${face.area.toFixed(3)}`,
  );
}
