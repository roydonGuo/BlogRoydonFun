import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"About","description":"","frontmatter":{"title":"About"},"headers":[],"relativePath":"en/about/index.md","filePath":"en/about/index.md","lastUpdated":1787035588000}');
const _sfc_main = { name: "en/about/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="about-ethan" tabindex="-1">About Ethan <a class="header-anchor" href="#about-ethan" aria-label="Permalink to “About Ethan”">​</a></h1><p>I write about software engineering, architecture, frontend development, design, and the lessons learned while building real products.</p><p>This English section is being expanded progressively. The complete site is available in <a href="/">Simplified Chinese</a>.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("en/about/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
