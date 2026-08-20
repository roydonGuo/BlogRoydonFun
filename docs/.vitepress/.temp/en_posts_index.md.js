import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Articles","description":"","frontmatter":{"title":"Articles"},"headers":[],"relativePath":"en/posts/index.md","filePath":"en/posts/index.md","lastUpdated":1787035588000}');
const _sfc_main = { name: "en/posts/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="articles" tabindex="-1">Articles <a class="header-anchor" href="#articles" aria-label="Permalink to “Articles”">​</a></h1><p>The technical articles are currently published in Chinese. English translations will be added progressively.</p><p><a href="/posts/">Browse all Chinese articles →</a></p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("en/posts/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
