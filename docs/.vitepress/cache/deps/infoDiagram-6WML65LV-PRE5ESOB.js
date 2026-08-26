import {
  parse
} from "./chunk-TNKVLVG6.js";
import "./chunk-P4USHDQP.js";
import "./chunk-DUF7FIKD.js";
import "./chunk-CLJH2YN5.js";
import "./chunk-3IDFJZWB.js";
import "./chunk-XC74COZQ.js";
import "./chunk-2U55VDWR.js";
import "./chunk-6FYEZFA7.js";
import "./chunk-OGR463FL.js";
import "./chunk-TWS6RCDZ.js";
import "./chunk-R3XFJMFQ.js";
import "./chunk-UPOXNC2N.js";
import "./chunk-KPTY45OG.js";
import "./chunk-X7H3OCYT.js";
import "./chunk-BOGFWGTH.js";
import "./chunk-TOQ5MULQ.js";
import "./chunk-BK4F4OLX.js";
import {
  selectSvgElement
} from "./chunk-TSWZKY57.js";
import {
  configureSvgSize
} from "./chunk-6N4JLKCU.js";
import {
  log
} from "./chunk-FLFJD6IB.js";
import {
  __name
} from "./chunk-DTCXZATX.js";
import "./chunk-5WRI5ZAA.js";

// node_modules/mermaid/dist/chunks/mermaid.core/infoDiagram-6WML65LV.mjs
var parser = {
  parse: __name(async (input) => {
    const ast = await parse("info", input);
    log.debug(ast);
  }, "parse")
};
var DEFAULT_INFO_DB = {
  version: "11.16.1" + (true ? "" : "-tiny")
};
var getVersion = __name(() => DEFAULT_INFO_DB.version, "getVersion");
var db = {
  getVersion
};
var draw = __name((text, id, version) => {
  log.debug("rendering info diagram\n" + text);
  const svg = selectSvgElement(id);
  configureSvgSize(svg, 100, 400, true);
  const group = svg.append("g");
  group.append("text").attr("x", 100).attr("y", 40).attr("class", "version").attr("font-size", 32).style("text-anchor", "middle").text(`v${version}`);
}, "draw");
var renderer = { draw };
var diagram = {
  parser,
  db,
  renderer
};
export {
  diagram
};
//# sourceMappingURL=infoDiagram-6WML65LV-PRE5ESOB.js.map
