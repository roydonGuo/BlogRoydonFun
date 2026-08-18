import {
  getConfig2
} from "./chunk-6N4JLKCU.js";
import {
  select_default
} from "./chunk-FLFJD6IB.js";
import {
  __name
} from "./chunk-DTCXZATX.js";

// node_modules/mermaid/dist/chunks/mermaid.core/chunk-3NCLNEKW.mjs
var selectSvgElement = __name((id) => {
  const { securityLevel } = getConfig2();
  let root = select_default("body");
  if (securityLevel === "sandbox") {
    const sandboxElement = select_default(`#i${id}`);
    const doc = sandboxElement.node()?.contentDocument ?? document;
    root = select_default(doc.body);
  }
  const svg = root.select(`#${id}`);
  return svg;
}, "selectSvgElement");

export {
  selectSvgElement
};
//# sourceMappingURL=chunk-TSWZKY57.js.map
