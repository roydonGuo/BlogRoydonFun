import {
  db,
  getStyles,
  renderer
} from "./chunk-GMMHXQIX.js";
import {
  populateCommonDb
} from "./chunk-WRNCOHW6.js";
import {
  MermaidParseError
} from "./chunk-VSVGWHWZ.js";
import {
  createRailroadServices
} from "./chunk-OGR463FL.js";
import "./chunk-TWS6RCDZ.js";
import "./chunk-R3XFJMFQ.js";
import "./chunk-UPOXNC2N.js";
import "./chunk-P4USHDQP.js";
import "./chunk-DUF7FIKD.js";
import "./chunk-CLJH2YN5.js";
import "./chunk-KPTY45OG.js";
import "./chunk-X7H3OCYT.js";
import "./chunk-BOGFWGTH.js";
import "./chunk-TOQ5MULQ.js";
import "./chunk-3IDFJZWB.js";
import "./chunk-XC74COZQ.js";
import "./chunk-2U55VDWR.js";
import "./chunk-6FYEZFA7.js";
import "./chunk-BK4F4OLX.js";
import "./chunk-TSWZKY57.js";
import "./chunk-6N4JLKCU.js";
import {
  log
} from "./chunk-FLFJD6IB.js";
import {
  __name
} from "./chunk-DTCXZATX.js";
import "./chunk-5WRI5ZAA.js";

// node_modules/mermaid/dist/chunks/mermaid.core/railroadDiagram-AXF67PYL.mjs
var langiumParser = createRailroadServices().Railroad.parser.LangiumParser;
var transformExpression = __name((expr) => {
  switch (expr.$type) {
    case "RailroadTerminalExpr":
      return {
        type: "terminal",
        value: expr.value
      };
    case "RailroadNonTerminalExpr":
      return {
        type: "nonterminal",
        name: expr.name
      };
    case "RailroadSpecialExpr":
      return {
        type: "special",
        text: expr.text
      };
    case "RailroadSequenceExpr": {
      const elements = expr.elements.map(transformExpression);
      return elements.length === 1 ? elements[0] : { type: "sequence", elements };
    }
    case "RailroadChoiceExpr": {
      const alternatives = expr.alternatives.map(transformExpression);
      return alternatives.length === 1 ? alternatives[0] : { type: "choice", alternatives };
    }
    case "RailroadOptionalExpr":
      return {
        type: "optional",
        element: transformExpression(expr.element)
      };
    case "RailroadOneOrMoreExpr":
      return {
        type: "repetition",
        element: transformExpression(expr.element),
        min: 1,
        max: Infinity
      };
    case "RailroadZeroOrMoreExpr":
      return {
        type: "repetition",
        element: transformExpression(expr.element),
        min: 0,
        max: Infinity
      };
    default:
      throw new Error(`Unsupported railroad expression: ${expr.$type}`);
  }
}, "transformExpression");
var transformRule = __name((rule) => {
  return {
    name: rule.name,
    definition: transformExpression(rule.definition)
  };
}, "transformRule");
var populateDb = __name((ast) => {
  populateCommonDb(ast, db);
  if (ast.title) {
    db.setTitle(ast.title);
  }
  ast.rules.map((rule) => db.addRule(transformRule(rule)));
}, "populateDb");
var parser = {
  parse: __name((input) => {
    db.clear();
    log.debug("[Railroad Parser] Starting Langium parse");
    const result = langiumParser.parse(input);
    if (result.lexerErrors.length > 0 || result.parserErrors.length > 0) {
      throw new MermaidParseError(result);
    }
    const ast = result.value;
    log.debug("[Railroad Parser] Parsed rules:", ast.rules.length);
    populateDb(ast);
    log.debug("[Railroad Parser] Parse complete");
  }, "parse"),
  parser: {
    yy: db
  }
};
var diagram = {
  parser,
  db,
  renderer,
  styles: getStyles
};
var railroadDiagram_default = diagram;
export {
  railroadDiagram_default as default,
  diagram
};
//# sourceMappingURL=railroadDiagram-AXF67PYL-TMN6ONLY.js.map
