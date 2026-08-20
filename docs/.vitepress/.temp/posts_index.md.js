import { resolveComponent, withCtx, createVNode, useSSRContext } from "vue";
import { ssrRenderAttrs, ssrRenderComponent } from "vue/server-renderer";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"文章","description":"","frontmatter":{"title":"文章"},"headers":[],"relativePath":"posts/index.md","filePath":"posts/index.md","lastUpdated":1787061026000}');
const _sfc_main = { name: "posts/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  const _component_ClientOnly = resolveComponent("ClientOnly");
  const _component_PostList = resolveComponent("PostList");
  _push(`<div${ssrRenderAttrs(_attrs)} data-v-58462843><div class="posts-header" data-v-58462843><h1 class="posts-title" data-v-58462843>文章</h1><p class="posts-subtitle" data-v-58462843>技术探索、生活思考、设计灵感 — 都在这里</p></div>`);
  _push(ssrRenderComponent(_component_ClientOnly, null, {
    default: withCtx((_, _push2, _parent2, _scopeId) => {
      if (_push2) {
        _push2(ssrRenderComponent(_component_PostList, null, null, _parent2, _scopeId));
      } else {
        return [
          createVNode(_component_PostList)
        ];
      }
    }),
    _: 1
  }, _parent));
  _push(`</div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("posts/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender], ["__scopeId", "data-v-58462843"]]);
export {
  __pageData,
  index as default
};
