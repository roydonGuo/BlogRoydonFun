import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"Ethan","text":"Thoughts on code, design & life","tagline":"记录技术与生活的个人博客","image":{"src":"/1fad0.svg","alt":"Ethan"},"actions":[{"theme":"brand","text":"最新文章","link":"/posts/"},{"theme":"alt","text":"关于我","link":"/about/"}]},"features":[{"title":"💻 技术","details":"前端开发、架构设计、工具链、最佳实践"},{"title":"✏️ 随笔","details":"生活记录、思考碎片、阅读笔记"},{"title":"🎨 设计","details":"UI/UX、视觉风格、设计系统"}]},"headers":[],"relativePath":"index.md","filePath":"index.md","lastUpdated":1787022537000}');
const _sfc_main = { name: "index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
