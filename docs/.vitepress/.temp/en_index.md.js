import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"Ethan","text":"Thoughts on code, design & life","tagline":"A personal blog about engineering, design, and everyday thinking","image":{"src":"/1fad0.svg","alt":"Ethan"},"actions":[{"theme":"brand","text":"Browse articles","link":"/en/posts/"},{"theme":"alt","text":"About me","link":"/en/about/"}]},"features":[{"title":"💻 Engineering","details":"Frontend development, backend architecture, tooling, and best practices"},{"title":"✏️ Notes","details":"Life updates, reflections, and reading notes"},{"title":"🎨 Design","details":"UI/UX, visual systems, and product design"}]},"headers":[],"relativePath":"en/index.md","filePath":"en/index.md","lastUpdated":1787035588000}');
const _sfc_main = { name: "en/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("en/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
