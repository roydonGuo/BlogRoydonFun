<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const rootRef = ref<HTMLDivElement | null>(null)
const artRef = ref<HTMLDivElement | null>(null)
const FONT_W = 4.8
const FONT_H = 8
const OVERSCALE = 3
const CHAR_RAMP = ' .`-_:,;^=+/|)\\!?0oOQ#%@'
const MIN_ZOOM = 1.45
const MAX_ZOOM = 2.38

interface ProgramInfo { program: WebGLProgram; position: number }
interface BufferInfo { texture: WebGLTexture; frameBuffer: WebGLFramebuffer }

let canvas: HTMLCanvasElement | null = null
let gl: WebGLRenderingContext | null = null
let quad: WebGLBuffer | null = null
let noiseTexture: WebGLTexture | null = null
let rayProgram: ProgramInfo | null = null
let displayProgram: ProgramInfo | null = null
let rayUniforms: Record<string, WebGLUniformLocation | null> = {}
let displayUniforms: Record<string, WebGLUniformLocation | null> = {}
let accA: BufferInfo | null = null
let accB: BufferInfo | null = null
let readback = new Uint8Array()
let previousLum = new Float32Array()
let cols = 0
let rows = 0
let fboW = 0
let fboH = 0
let width = 0
let height = 0
let mx = 0.5
let my = 0.35
let targetMx = 0.5
let targetMy = 0.35
let prevMx = 0.5
let prevMy = 0.35
let zoom = 2.35
let targetZoom = 2.35
let prevZoom = 2.35
let frame = 0
let resizeTimer = 0
let observer: ResizeObserver | null = null
let startTime = 0

const common = `
precision highp float;
uniform vec3 uRes;uniform float uTime;uniform vec2 uMouse;uniform float uMoving;
uniform float uZoom;uniform float uAspect;uniform sampler2D uNoise;
const float pi=3.14159265;
float saturate(float x){return clamp(x,0.0,1.0);}vec3 sat3(vec3 x){return clamp(x,vec3(0.0),vec3(1.0));}
float texNoise(vec3 x){vec3 p=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);vec2 uv=(p.xy+vec2(37.0,17.0)*p.z)+f.xy;vec2 rg=texture2D(uNoise,(uv+0.5)/256.0).yx;return mix(rg.x,rg.y,f.z)*2.0-1.0;}
float pcurve(float x,float a,float b){float k=pow(a+b,a+b)/(pow(a,a)*pow(b,b));return k*pow(x,a)*pow(1.0-x,b);}
float atan2(float y,float x){if(x>0.0)return atan(y/x);else if(x==0.0)return y>0.0?pi*0.5:(y<0.0?-pi*0.5:0.0);else return y>=0.0?atan(y/x)+pi:atan(y/x)-pi;}
float rand(vec2 co){return saturate(fract(sin(dot(co,vec2(12.9898,78.223)))*43758.5453));}
float sdTorus(vec3 p,vec2 t){vec2 q=vec2(length(p.xz)-t.x,p.y);return length(q)-t.y;}
`

const raySource = common + `
uniform sampler2D uPrev;const int ITERATIONS=150;
void Haze(inout vec3 color,vec3 pos,float alpha){vec2 t=vec2(1.0,0.01);float d=length(sdTorus(pos+vec3(0.0,-0.05,0.0),t));float bloom=1.0/(d*d+0.001);bloom*=length(pos)<0.5?0.0:1.0;color+=vec3(1.0)*bloom*(2.9/float(ITERATIONS))*(1.0-alpha);}
void GasDisc(inout vec3 color,inout float alpha,vec3 pos){
float discRadius=3.2,discWidth=5.3,discInner=discRadius-discWidth*0.5;vec3 origin=vec3(0.0),discNormal=normalize(vec3(0.0,1.0,0.0));float discThickness=0.1;float distFromCenter=distance(pos,origin);float distFromDisc=dot(discNormal,pos-origin);float radialGradient=1.0-saturate((distFromCenter-discInner)/discWidth*0.5);float coverage=pcurve(radialGradient,4.0,0.9);discThickness*=radialGradient;coverage*=saturate(1.0-abs(distFromDisc)/discThickness);vec3 dustColorLit=vec3(1.0);float dustGlow=1.0/(pow(1.0-radialGradient,2.0)*290.0+0.002);vec3 dustColor=dustColorLit*dustGlow*8.2;coverage=saturate(coverage*0.7);float fade=pow(abs(distFromCenter-discInner)+0.4,4.0)*0.04;float bloomFactor=1.0/(distFromDisc*distFromDisc*40.0+fade+0.00002);vec3 b=dustColorLit*pow(bloomFactor,1.5);b*=mix(vec3(1.7,1.1,1.0),vec3(0.5,0.6,1.0),vec3(pow(radialGradient,2.0)));b*=mix(vec3(1.7,0.5,0.1),vec3(1.0),vec3(pow(radialGradient,0.5)));dustColor=mix(dustColor,b*150.0,saturate(1.0-coverage));coverage=saturate(coverage+bloomFactor*bloomFactor*0.1);if(coverage<0.01)return;
vec3 rc;rc.x=distFromCenter*1.5+0.55;rc.y=atan2(-pos.x,-pos.z)*1.5;rc.z=distFromDisc*1.5;rc*=0.95;float speed=0.06;float n1=1.0;vec3 r=rc;r.y+=uTime*speed;n1*=texNoise(r*3.0)*0.5+0.5;r.y-=uTime*speed;r.y+=uTime*speed;n1*=texNoise(r*6.0)*0.5+0.5;r.y-=uTime*speed;r.y+=uTime*speed;n1*=texNoise(r*12.0)*0.5+0.5;r.y-=uTime*speed;r.y+=uTime*speed;n1*=texNoise(r*24.0)*0.5+0.5;float n2=2.0;r=rc+30.0;n2*=texNoise(r*3.0)*0.5+0.5;r.y+=uTime*speed;n2*=texNoise(r*6.0)*0.5+0.5;r.y-=uTime*speed;n2*=texNoise(r*12.0)*0.5+0.5;r.y+=uTime*speed;n2*=texNoise(r*24.0)*0.5+0.5;r.y-=uTime*speed;n2*=texNoise(r*48.0)*0.5+0.5;r.y+=uTime*speed;n2*=texNoise(r*92.0)*0.5+0.5;dustColor*=n1*0.998+0.002;coverage*=n2;float sw=sin(rc.y*3.0+rc.x*5.0+uTime*speed*0.5)*0.5+0.5;float sw2=sin(rc.y*7.0-rc.x*3.0+uTime*speed*0.3)*0.5+0.5;dustColor*=pow(vec3(sw*sw2),vec3(2.0))*4.0;coverage=saturate(coverage*1200.0/float(ITERATIONS));dustColor=max(vec3(0.0),dustColor);coverage*=pcurve(radialGradient,4.0,0.9);color=(1.0-alpha)*dustColor*coverage+color;alpha=(1.0-alpha)*coverage+alpha;}
vec3 rotate(vec3 p,float x,float y,float z){mat3 mx=mat3(1,0,0,0,cos(x),sin(x),0,-sin(x),cos(x));mat3 my=mat3(cos(y),0,-sin(y),0,1,0,sin(y),0,cos(y));mat3 mz=mat3(cos(z),sin(z),0,-sin(z),cos(z),0,0,0,1);return my*mz*mx*p;}
void WarpSpace(inout vec3 eyevec,inout vec3 raypos){vec3 origin=vec3(0.0);float sd=distance(raypos,origin);float wf=1.0/(sd*sd+0.000001);eyevec=normalize(eyevec+normalize(origin-raypos)*wf*5.0/float(ITERATIONS));}
void main(){vec2 uv=gl_FragCoord.xy/uRes.xy;vec2 uveye=uv;uveye.x+=rand(uv+sin(uTime))/uRes.x;uveye.y+=rand(uv+1.0+sin(uTime))/uRes.y;vec3 eyevec=normalize(vec3((uveye*2.0-1.0)*vec2(uAspect,1.0),6.0));vec3 eyepos=vec3(0.0,0.0,-10.0+uMouse.y*4.0-(uZoom-1.0)*5.0);float camX=uMouse.y*0.4-0.1,camY=uMouse.x*2.5+0.5,camZ=-0.45;eyevec=rotate(eyevec,camX,camY,camZ);eyepos=rotate(eyepos,camX,camY,camZ);const float far=15.0;vec3 color=vec3(0.0);float alpha=0.0;float dither=rand(uv+sin(uTime))*2.0;vec3 raypos=eyepos+eyevec*dither*far/float(ITERATIONS);for(int i=0;i<ITERATIONS;i++){WarpSpace(eyevec,raypos);raypos+=eyevec*far/float(ITERATIONS);GasDisc(color,alpha,raypos);Haze(color,raypos,alpha);}color*=0.0001;vec3 previous=texture2D(uPrev,uv).rgb;color=mix(color,previous,0.92*uMoving);gl_FragColor=vec4(sat3(color),1.0);}
`

const displaySource = common + `
uniform sampler2D uAccum;
void main(){vec2 uv=gl_FragCoord.xy/uRes.xy;vec3 color=texture2D(uAccum,uv).rgb;vec3 blur=vec3(0.0);float s=8.0/uRes.x;for(int i=-3;i<=3;i++){for(int j=-3;j<=3;j++){vec2 off=vec2(float(i),float(j));float w=1.0/(1.0+dot(off,off));blur+=texture2D(uAccum,uv+off*s).rgb*w;}}blur/=49.0;color+=blur*0.06;color*=200.0;color=pow(color,vec3(1.5));color=color/(1.0+color);color=pow(color,vec3(1.0/1.5));color=mix(color,color*color*(3.0-2.0*color),vec3(1.0));color=pow(color,vec3(1.3,1.20,1.0));color=sat3(color*1.01);color=pow(color,vec3(0.7/2.2));gl_FragColor=vec4(color,1.0);}
`

function compile(type: number, source: string): WebGLShader {
  if (!gl) throw new Error('WebGL unavailable')
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed')
  return shader
}

function makeProgram(fragmentSource: string): ProgramInfo {
  if (!gl) throw new Error('WebGL unavailable')
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create program')
  gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}'))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program link failed')
  return { program, position: gl.getAttribLocation(program, 'a_pos') }
}

function createBuffer(w: number, h: number): BufferInfo {
  if (!gl) throw new Error('WebGL unavailable')
  const texture = gl.createTexture()
  const frameBuffer = gl.createFramebuffer()
  if (!texture || !frameBuffer) throw new Error('Framebuffer allocation failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  return { texture, frameBuffer }
}

function releaseBuffer(info: BufferInfo | null): void {
  if (!gl || !info) return
  gl.deleteFramebuffer(info.frameBuffer)
  gl.deleteTexture(info.texture)
}

function createNoise(): WebGLTexture {
  if (!gl) throw new Error('WebGL unavailable')
  const size = 256
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    const v1 = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    const v2 = Math.sin(x * 269.5 + y * 183.3) * 43758.5453
    data[i] = ((v1 - Math.floor(v1)) * 255) | 0
    data[i + 1] = ((v2 - Math.floor(v2)) * 255) | 0
    data[i + 2] = data[i]
    data[i + 3] = data[i + 1]
  }
  const texture = gl.createTexture()
  if (!texture) throw new Error('Noise texture allocation failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  return texture
}

function drawQuad(info: ProgramInfo): void {
  if (!gl || !quad) return
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.enableVertexAttribArray(info.position)
  gl.vertexAttribPointer(info.position, 2, gl.FLOAT, false, 0, 0)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
}

function rebuild(): void {
  if (!gl || !canvas || !rootRef.value || !artRef.value) return
  const rect = rootRef.value.getBoundingClientRect()
  width = Math.max(1, Math.floor(rect.width))
  height = Math.max(1, Math.floor(rect.height))
  cols = Math.max(1, Math.floor(width / FONT_W))
  rows = Math.max(1, Math.floor(height / FONT_H))
  fboW = cols * OVERSCALE
  fboH = rows * OVERSCALE
  canvas.width = fboW
  canvas.height = fboH
  releaseBuffer(accA)
  releaseBuffer(accB)
  accA = createBuffer(fboW, fboH)
  accB = createBuffer(fboW, fboH)
  readback = new Uint8Array(fboW * fboH * 4)
  previousLum = new Float32Array(cols * rows)
  artRef.value.replaceChildren(...Array.from({ length: rows }, () => document.createElement('div')))
}

function render(): void {
  if (!gl || !rayProgram || !displayProgram || !accA || !accB || !noiseTexture || !artRef.value) return
  const time = (performance.now() - startTime) * 0.001
  mx += (targetMx - mx) * 0.08
  my += (targetMy - my) * 0.08
  zoom += (targetZoom - zoom) * 0.12
  const motion = Math.hypot(mx - prevMx, my - prevMy) + Math.abs(zoom - prevZoom) * 0.5
  const moving = Math.max(0, Math.min(1, 1 - motion * 400))
  prevMx = mx
  prevMy = my
  prevZoom = zoom

  gl.bindFramebuffer(gl.FRAMEBUFFER, accA.frameBuffer)
  gl.viewport(0, 0, fboW, fboH)
  gl.useProgram(rayProgram.program)
  gl.uniform3f(rayUniforms.uRes, fboW, fboH, 1)
  gl.uniform1f(rayUniforms.uTime, time)
  gl.uniform2f(rayUniforms.uMouse, mx, my)
  gl.uniform1f(rayUniforms.uMoving, moving)
  gl.uniform1f(rayUniforms.uZoom, zoom)
  gl.uniform1f(rayUniforms.uAspect, width / height)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, noiseTexture)
  gl.uniform1i(rayUniforms.uNoise, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, accB.texture)
  gl.uniform1i(rayUniforms.uPrev, 1)
  drawQuad(rayProgram)
  const swap = accA
  accA = accB
  accB = swap

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.useProgram(displayProgram.program)
  gl.uniform3f(displayUniforms.uRes, fboW, fboH, 1)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, accA.texture)
  gl.uniform1i(displayUniforms.uAccum, 0)
  drawQuad(displayProgram)
  gl.readPixels(0, 0, fboW, fboH, gl.RGBA, gl.UNSIGNED_BYTE, readback)

  const blend = 0.25 + moving * 0.45
  for (let row = 0; row < rows; row++) {
    let line = ''
    for (let col = 0; col < cols; col++) {
      let red = 0
      let green = 0
      let blue = 0
      for (let sy = 0; sy < OVERSCALE; sy++) for (let sx = 0; sx < OVERSCALE; sx++) {
        const px = col * OVERSCALE + sx
        const py = fboH - 1 - (row * OVERSCALE + sy)
        const i = (py * fboW + px) * 4
        red += readback[i]
        green += readback[i + 1]
        blue += readback[i + 2]
      }
      const raw = (0.299 * red + 0.587 * green + 0.114 * blue) / (255 * OVERSCALE * OVERSCALE)
      const fieldIndex = row * cols + col
      const lum = raw * blend + previousLum[fieldIndex] * (1 - blend)
      previousLum[fieldIndex] = lum
      line += CHAR_RAMP[Math.min(CHAR_RAMP.length - 1, Math.max(0, lum) * CHAR_RAMP.length | 0)]
    }
    artRef.value.children[row].textContent = line
  }
  frame = window.requestAnimationFrame(render)
}

function handlePointer(event: PointerEvent): void {
  const rect = rootRef.value?.getBoundingClientRect()
  if (!rect) return
  targetMx = (event.clientX - rect.left) / rect.width
  targetMy = (event.clientY - rect.top) / rect.height
}

function handleWheel(event: WheelEvent): void {
  const rect = rootRef.value?.parentElement?.getBoundingClientRect()
  if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return
  event.preventDefault()
  const direction = Math.sign(event.deltaY)
  targetZoom += direction * 0.025
  targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom))
}

function queueResize(): void {
  window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(rebuild, 160)
}

onMounted(() => {
  const root = rootRef.value
  if (!root) return
  canvas = document.createElement('canvas')
  gl = canvas.getContext('webgl', { antialias: false, alpha: true, preserveDrawingBuffer: true })
  if (!gl) return
  rayProgram = makeProgram(raySource)
  displayProgram = makeProgram(displaySource)
  quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  noiseTexture = createNoise()
  for (const name of ['uRes', 'uTime', 'uMouse', 'uMoving', 'uZoom', 'uAspect', 'uNoise', 'uPrev']) rayUniforms[name] = gl.getUniformLocation(rayProgram.program, name)
  for (const name of ['uRes', 'uAccum']) displayUniforms[name] = gl.getUniformLocation(displayProgram.program, name)
  observer = new ResizeObserver(queueResize)
  observer.observe(root)
  window.addEventListener('pointermove', handlePointer, { passive: true })
  window.addEventListener('wheel', handleWheel, { passive: false })
  startTime = performance.now()
  rebuild()
  frame = window.requestAnimationFrame(render)
})

onBeforeUnmount(() => {
  if (frame) window.cancelAnimationFrame(frame)
  window.clearTimeout(resizeTimer)
  observer?.disconnect()
  window.removeEventListener('pointermove', handlePointer)
  window.removeEventListener('wheel', handleWheel)
  releaseBuffer(accA)
  releaseBuffer(accB)
  if (gl && noiseTexture) gl.deleteTexture(noiseTexture)
  if (gl && quad) gl.deleteBuffer(quad)
  if (gl && rayProgram) gl.deleteProgram(rayProgram.program)
  if (gl && displayProgram) gl.deleteProgram(displayProgram.program)
  gl = null
  canvas = null
})
</script>

<template>
  <div ref="rootRef" class="gargantua-ascii" aria-label="可交互的 ASCII 黑洞特效">
    <div ref="artRef" class="gargantua-ascii__art" aria-hidden="true" />
  </div>
</template>

<style scoped>
.gargantua-ascii {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(100vw, 1320px);
  height: min(82vh, 680px);
  overflow: visible;
  transform: translate(-50%, -50%);
  background: transparent;
  pointer-events: none;
}

.gargantua-ascii__art {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: visible;
  color: rgba(200, 165, 100, 0.82);
  font: 8px/8px "Courier New", Courier, monospace;
  white-space: pre;
  user-select: none;
  background: transparent;
}
</style>
