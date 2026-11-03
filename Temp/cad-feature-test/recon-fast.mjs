import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const runtimeDir = process.argv[2];
const inputFile = process.argv[3];
const threshold = Number.parseFloat(process.argv[4] ?? "2");
const maxPlanes = Number.parseInt(process.argv[5] ?? "25", 10);
const useCylinders = process.argv[6] !== "nocyl";
const outputFile = process.argv[7] ?? path.resolve("experimental-front-panel.stp");
const maxSamples = Number.parseInt(process.argv[8] ?? "17", 10);
const minimumInsideFraction = Number.parseFloat(process.argv[9] ?? "0.5");

global.___cxa_is_pointer_type = () => 0;
global.___cxa_can_catch = () => 1;

const opencascade = require(path.join(runtimeDir, "oc.cjs"));
const oc = await new opencascade({
  wasmBinary: fs.readFileSync(path.join(runtimeDir, "opencascade.wasm.wasm")),
});

const startedAt = Date.now();
const lap = (message) => {
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
};
const each = (shape, type, callback) => {
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    type,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (explorer.More()) {
    callback(explorer.Current());
    explorer.Next();
  }
};
const volume = (shape) => {
  const properties = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, properties, false, false, false);
  return properties.Mass();
};
const point = (x, y, z) => new oc.gp_Pnt_3(x, y, z);
const quantize = (value) => Math.round(value * 100) / 100;

oc.FS.writeFile("/input.stp", fs.readFileSync(inputFile));
const reader = new oc.STEPControl_Reader_1();
const readStatus = reader.ReadFile("/input.stp");
reader.TransferRoots();
const original = reader.OneShape();
lap(`loaded STEP status=${readStatus.value ?? readStatus}`);

const surfaceNames = {};
for (const key of Object.keys(oc.GeomAbs_SurfaceType)) {
  const value = oc.GeomAbs_SurfaceType[key];
  if (value?.value !== undefined) {
    surfaceNames[value.value] = key.replace("GeomAbs_", "");
  }
}

const planes = new Map();
const cylinders = new Map();
let unsupportedLargeFaces = 0;
each(original, oc.TopAbs_ShapeEnum.TopAbs_FACE, (rawFace) => {
  const face = oc.TopoDS.Face_1(rawFace);
  const surface = new oc.BRepAdaptor_Surface_2(face, true);
  const type = surfaceNames[surface.GetType().value];

  const areaProperties = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(face, areaProperties, false, false);
  const linearProperties = new oc.GProp_GProps_1();
  oc.BRepGProp.LinearProperties(face, linearProperties, false, false);
  const area = areaProperties.Mass();
  const perimeter = linearProperties.Mass();
  const width = perimeter > 0 ? (2 * area) / perimeter : 0;
  if (width < threshold) return;

  if (type === "Plane") {
    const plane = surface.Plane();
    const normal = plane.Axis().Direction();
    const origin = plane.Location();
    let nx = normal.X();
    let ny = normal.Y();
    let nz = normal.Z();
    let d = nx * origin.X() + ny * origin.Y() + nz * origin.Z();
    if (
      nx < -1e-9 ||
      (Math.abs(nx) < 1e-9 &&
        (ny < -1e-9 || (Math.abs(ny) < 1e-9 && nz < 0)))
    ) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      d = -d;
    }
    const key = [nx, ny, nz, d].map(quantize).join(",");
    const entry = planes.get(key) ?? { surface: plane, area: 0 };
    entry.area += area;
    planes.set(key, entry);
    return;
  }

  if (type === "Cylinder") {
    const cylinder = surface.Cylinder();
    const axis = cylinder.Axis();
    const origin = cylinder.Location();
    const key = [
      axis.Direction().X(),
      axis.Direction().Y(),
      axis.Direction().Z(),
      origin.X(),
      origin.Y(),
      origin.Z(),
      cylinder.Radius(),
    ]
      .map(quantize)
      .join(",");
    const entry = cylinders.get(key) ?? { surface: cylinder, area: 0 };
    entry.area += area;
    cylinders.set(key, entry);
    return;
  }

  unsupportedLargeFaces += 1;
});

const selectedPlanes = [...planes.values()]
  .sort((left, right) => right.area - left.area)
  .slice(0, maxPlanes);
console.log({
  uniqueLargePlanes: planes.size,
  selectedPlanes: selectedPlanes.length,
  uniqueLargeCylinders: cylinders.size,
  useCylinders,
  unsupportedLargeFaces,
});

const extension = 2000;
const tools = new oc.TopTools_ListOfShape_1();
for (const entry of selectedPlanes) {
  tools.Append_1(
    new oc.BRepBuilderAPI_MakeFace_9(
      entry.surface,
      -extension,
      extension,
      -extension,
      extension,
    ).Face(),
  );
}
if (useCylinders) {
  for (const entry of cylinders.values()) {
    tools.Append_1(
      new oc.BRepBuilderAPI_MakeFace_10(
        entry.surface,
        0,
        2 * Math.PI,
        -extension,
        extension,
      ).Face(),
    );
  }
}

const bounds = new oc.Bnd_Box_1();
oc.BRepBndLib.Add(original, bounds, false);
const lower = bounds.CornerMin();
const upper = bounds.CornerMax();
const margin = 5;
const boundingShape = new oc.BRepPrimAPI_MakeBox_2(
  point(lower.X() - margin, lower.Y() - margin, lower.Z() - margin),
  upper.X() - lower.X() + 2 * margin,
  upper.Y() - lower.Y() + 2 * margin,
  upper.Z() - lower.Z() + 2 * margin,
).Shape();

const argumentsList = new oc.TopTools_ListOfShape_1();
argumentsList.Append_1(boundingShape);
const splitter = new oc.BRepAlgoAPI_Splitter_1();
splitter.SetArguments(argumentsList);
splitter.SetTools(tools);
splitter.Build();
lap(`splitter done=${splitter.IsDone()}`);

const cells = [];
each(splitter.Shape(), oc.TopAbs_ShapeEnum.TopAbs_SOLID, (rawSolid) => {
  cells.push(oc.TopoDS.Solid_1(rawSolid));
});
lap(`cells=${cells.length}`);

const originalClassifier = new oc.BRepClass3d_SolidClassifier_2(original);
const classify = (sample) => {
  originalClassifier.Perform(sample, 1e-6);
  const state = originalClassifier.State();
  return (
    state === oc.TopAbs_State.TopAbs_IN ||
    state === oc.TopAbs_State.TopAbs_ON
  );
};

const included = [];
for (let index = 0; index < cells.length; index += 1) {
  const cell = cells[index];
  const cellVolume = volume(cell);
  if (cellVolume < 1e-6) continue;

  const properties = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(cell, properties, false, false, false);
  const center = properties.CentreOfMass();
  const samples = [point(center.X(), center.Y(), center.Z())];
  const seenVertices = new Set();
  each(cell, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, (rawVertex) => {
    if (samples.length >= maxSamples) return;
    const vertex = oc.TopoDS.Vertex_1(rawVertex);
    const vertexPoint = oc.BRep_Tool.Pnt(vertex);
    const key = [vertexPoint.X(), vertexPoint.Y(), vertexPoint.Z()]
      .map(quantize)
      .join(",");
    if (seenVertices.has(key)) return;
    seenVertices.add(key);
    samples.push(
      point(
        center.X() * 0.7 + vertexPoint.X() * 0.3,
        center.Y() * 0.7 + vertexPoint.Y() * 0.3,
        center.Z() * 0.7 + vertexPoint.Z() * 0.3,
      ),
    );
  });

  const insideVotes = samples.reduce(
    (total, sample) => total + (classify(sample) ? 1 : 0),
    0,
  );
  if (insideVotes / samples.length >= minimumInsideFraction) included.push(cell);
  if ((index + 1) % 100 === 0) {
    lap(`classified ${index + 1}/${cells.length}, included=${included.length}`);
  }
}
lap(`included cells=${included.length}`);

if (included.length === 0) {
  throw new Error("No cells were classified inside the original solid.");
}

let result = included[0];
for (let index = 1; index < included.length; index += 1) {
  result = new oc.BRepAlgoAPI_Fuse_3(result, included[index]).Shape();
  if ((index + 1) % 50 === 0) {
    lap(`fused ${index + 1}/${included.length}`);
  }
}
const unify = new oc.ShapeUpgrade_UnifySameDomain_2(result, true, true, true);
unify.Build();
result = unify.Shape();
lap("unified result");

let resultFaces = 0;
let resultSolids = 0;
const resultSolidVolumes = [];
each(result, oc.TopAbs_ShapeEnum.TopAbs_FACE, () => resultFaces += 1);
each(result, oc.TopAbs_ShapeEnum.TopAbs_SOLID, (rawSolid) => {
  resultSolids += 1;
  resultSolidVolumes.push(volume(oc.TopoDS.Solid_1(rawSolid)));
});
const resultVolume = volume(result);
const originalVolume = volume(original);
const volumeRatio = resultVolume / originalVolume;
const valid = new oc.BRepCheck_Analyzer(result, true).IsValid_2();
console.log({
  originalVolume,
  resultVolume,
  volumeRatio,
  resultFaces,
  resultSolids,
  resultSolidVolumes: resultSolidVolumes.sort((left, right) => right - left),
  valid,
});

if (valid && resultSolids === 1 && volumeRatio >= 0.9) {
  const writer = new oc.STEPControl_Writer_1();
  writer.Transfer(result, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  const writeStatus = writer.Write("/experimental.stp");
  fs.writeFileSync(outputFile, oc.FS.readFile("/experimental.stp"));
  lap(`wrote ${outputFile}, status=${writeStatus.value ?? writeStatus}`);
} else {
  lap("skipped STEP output because validity, single-solid, and 90% volume checks did not all pass");
  process.exitCode = 2;
}
