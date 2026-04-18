"use client"

import * as React from "react"

import {
  resolveBlurRenderModeFromWindowState,
  type BlurRenderMode,
} from "@/lib/background-render-mode"
import { cn } from "@/lib/utils"

type ImageRect = {
  left: number
  top: number
  width: number
  height: number
}

interface WebGLBlurCanvasProps {
  src: string | null
  width: number
  height: number
  imageRect: ImageRect | null
  blur: number
  opacity?: number
  className?: string
  style?: React.CSSProperties
  pixelRatioCap?: number
  quality?: "balanced" | "performance"
  cropToImageRect?: boolean
  renderMode?: "auto" | BlurRenderMode
  onFrameRendered?: () => void
}

type RenderTarget = {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
}

type ProgramInfo = {
  program: WebGLProgram
  positionLocation: number
  imageSamplerLocation: WebGLUniformLocation | null
  canvasSizeLocation: WebGLUniformLocation | null
  imageRectLocation: WebGLUniformLocation | null
  textureSamplerLocation: WebGLUniformLocation | null
  texelSizeLocation: WebGLUniformLocation | null
  directionLocation: WebGLUniformLocation | null
  radiusLocation: WebGLUniformLocation | null
  cropToImageRectLocation: WebGLUniformLocation | null
}

type GLResources = {
  gl: WebGLRenderingContext
  quadBuffer: WebGLBuffer
  sourceTexture: WebGLTexture
  sceneProgram: ProgramInfo
  blurProgram: ProgramInfo
  copyProgram: ProgramInfo
  renderTargets: [RenderTarget | null, RenderTarget | null]
  uploadedSourceKey: string | null
  loseContextExtension: WEBGL_lose_context | null
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const SCENE_FRAGMENT_SHADER_SOURCE = `
precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_image;
uniform vec2 u_canvasSize;
uniform vec4 u_imageRect;

void main() {
  vec2 fragPx = vec2(v_uv.x * u_canvasSize.x, (1.0 - v_uv.y) * u_canvasSize.y);
  vec2 imageUv = clamp((fragPx - u_imageRect.xy) / u_imageRect.zw, 0.0, 1.0);
  gl_FragColor = texture2D(u_image, imageUv);
}
`

const BLUR_FRAGMENT_SHADER_SOURCE = `
precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec2 u_direction;
uniform float u_radius;

void main() {
  vec2 offset1 = u_direction * u_texelSize * 1.3846153846 * u_radius;
  vec2 offset2 = u_direction * u_texelSize * 3.2307692308 * u_radius;

  vec4 color = texture2D(u_texture, v_uv) * 0.2270270270;
  color += texture2D(u_texture, v_uv + offset1) * 0.3162162162;
  color += texture2D(u_texture, v_uv - offset1) * 0.3162162162;
  color += texture2D(u_texture, v_uv + offset2) * 0.0702702703;
  color += texture2D(u_texture, v_uv - offset2) * 0.0702702703;

  gl_FragColor = color;
}
`

const COPY_FRAGMENT_SHADER_SOURCE = `
precision mediump float;

varying vec2 v_uv;

uniform sampler2D u_texture;
uniform vec2 u_canvasSize;
uniform vec4 u_imageRect;
uniform float u_cropToImageRect;

void main() {
  vec4 color = texture2D(u_texture, v_uv);

  if (u_cropToImageRect > 0.5) {
    vec2 fragPx = vec2(v_uv.x * u_canvasSize.x, (1.0 - v_uv.y) * u_canvasSize.y);
    bool insideX = fragPx.x >= u_imageRect.x - 0.5 && fragPx.x <= u_imageRect.x + u_imageRect.z + 0.5;
    bool insideY = fragPx.y >= u_imageRect.y - 0.5 && fragPx.y <= u_imageRect.y + u_imageRect.w + 0.5;

    if (!(insideX && insideY)) {
      color = vec4(0.0);
    }
  }

  gl_FragColor = color;
}
`

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error("Failed to create WebGL shader.")
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader
  }

  const message = gl.getShaderInfoLog(shader) || "Unknown shader compilation error."
  gl.deleteShader(shader)
  throw new Error(message)
}

function createProgramInfo(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): ProgramInfo {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()

  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    throw new Error("Failed to create WebGL program.")
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown program link error."
    gl.deleteProgram(program)
    throw new Error(message)
  }

  return {
    program,
    positionLocation: gl.getAttribLocation(program, "a_position"),
    imageSamplerLocation: gl.getUniformLocation(program, "u_image"),
    canvasSizeLocation: gl.getUniformLocation(program, "u_canvasSize"),
    imageRectLocation: gl.getUniformLocation(program, "u_imageRect"),
    textureSamplerLocation: gl.getUniformLocation(program, "u_texture"),
    texelSizeLocation: gl.getUniformLocation(program, "u_texelSize"),
    directionLocation: gl.getUniformLocation(program, "u_direction"),
    radiusLocation: gl.getUniformLocation(program, "u_radius"),
    cropToImageRectLocation: gl.getUniformLocation(program, "u_cropToImageRect"),
  }
}

function createQuadBuffer(gl: WebGLRenderingContext) {
  const buffer = gl.createBuffer()
  if (!buffer) {
    throw new Error("Failed to create WebGL quad buffer.")
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]),
    gl.STATIC_DRAW,
  )
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  return buffer
}

function createTexture(gl: WebGLRenderingContext) {
  const texture = gl.createTexture()
  if (!texture) {
    throw new Error("Failed to create WebGL texture.")
  }

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return texture
}

function ensureRenderTarget(
  gl: WebGLRenderingContext,
  currentTarget: RenderTarget | null,
  width: number,
  height: number,
) {
  if (
    currentTarget &&
    currentTarget.width === width &&
    currentTarget.height === height
  ) {
    return currentTarget
  }

  if (currentTarget) {
    gl.deleteFramebuffer(currentTarget.framebuffer)
    gl.deleteTexture(currentTarget.texture)
  }

  const texture = createTexture(gl)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  )

  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) {
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteTexture(texture)
    throw new Error("Failed to create WebGL framebuffer.")
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  )

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.deleteFramebuffer(framebuffer)
    gl.deleteTexture(texture)
    throw new Error("Incomplete WebGL framebuffer.")
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return {
    texture,
    framebuffer,
    width,
    height,
  }
}

function bindQuad(gl: WebGLRenderingContext, programInfo: ProgramInfo, quadBuffer: WebGLBuffer) {
  gl.useProgram(programInfo.program)
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.enableVertexAttribArray(programInfo.positionLocation)
  gl.vertexAttribPointer(programInfo.positionLocation, 2, gl.FLOAT, false, 0, 0)
}

function getWorkingScale(
  outputWidth: number,
  outputHeight: number,
  blur: number,
  quality: "balanced" | "performance",
) {
  const maxDimension = Math.max(outputWidth, outputHeight)
  let scale = 1

  if (blur > 20) {
    scale = 0.38
  } else if (blur > 12) {
    scale = 0.5
  } else if (blur > 6) {
    scale = 0.68
  } else if (blur > 2) {
    scale = 0.85
  }

  if (quality === "performance") {
    scale *= 0.9
  }

  if (maxDimension >= 2200) {
    scale = Math.min(scale, quality === "performance" ? 0.42 : 0.5)
  } else if (maxDimension >= 1600) {
    scale = Math.min(scale, quality === "performance" ? 0.5 : 0.65)
  }

  return clamp(scale, 0.28, 1)
}

function getBlurPassPlan(blurInPixels: number) {
  if (blurInPixels <= 0.75) {
    return { iterations: 0, radius: 0 }
  }
  if (blurInPixels <= 4) {
    return { iterations: 1, radius: Math.max(0.7, blurInPixels * 0.55) }
  }
  if (blurInPixels <= 10) {
    return { iterations: 2, radius: Math.max(1, blurInPixels * 0.32) }
  }
  return { iterations: 3, radius: Math.max(1.15, blurInPixels * 0.22) }
}

function resetCanvasBackbuffer(canvas: HTMLCanvasElement | null) {
  if (!canvas || (canvas.width === 0 && canvas.height === 0)) {
    return
  }

  canvas.width = 0
  canvas.height = 0
}

function createResources(gl: WebGLRenderingContext): GLResources {
  const quadBuffer = createQuadBuffer(gl)
  return {
    gl,
    quadBuffer,
    sourceTexture: createTexture(gl),
    sceneProgram: createProgramInfo(gl, VERTEX_SHADER_SOURCE, SCENE_FRAGMENT_SHADER_SOURCE),
    blurProgram: createProgramInfo(gl, VERTEX_SHADER_SOURCE, BLUR_FRAGMENT_SHADER_SOURCE),
    copyProgram: createProgramInfo(gl, VERTEX_SHADER_SOURCE, COPY_FRAGMENT_SHADER_SOURCE),
    renderTargets: [null, null],
    uploadedSourceKey: null,
    loseContextExtension: gl.getExtension("WEBGL_lose_context"),
  }
}

function destroyResources(resources: GLResources, options?: { loseContext?: boolean }) {
  const { gl } = resources
  gl.deleteBuffer(resources.quadBuffer)
  gl.deleteTexture(resources.sourceTexture)
  resources.renderTargets.forEach((target) => {
    if (!target) {
      return
    }
    gl.deleteFramebuffer(target.framebuffer)
    gl.deleteTexture(target.texture)
  })
  gl.deleteProgram(resources.sceneProgram.program)
  gl.deleteProgram(resources.blurProgram.program)
  gl.deleteProgram(resources.copyProgram.program)

  if (options?.loseContext) {
    resources.loseContextExtension?.loseContext()
  }
}

export function WebGLBlurCanvas(props: WebGLBlurCanvasProps) {
  const {
    src,
    width,
    height,
    imageRect,
    blur,
    opacity = 1,
    className,
    style,
    pixelRatioCap = 1.5,
    quality = "balanced",
    cropToImageRect = false,
    renderMode = "auto",
    onFrameRendered,
  } = props

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const resourcesRef = React.useRef<GLResources | null>(null)
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const frameRef = React.useRef<number | null>(null)
  const notifyFrameRef = React.useRef<number | null>(null)
  const [imageReadyKey, setImageReadyKey] = React.useState<string | null>(null)
  const [fallbackMode, setFallbackMode] = React.useState(false)
  const resolvedRenderMode = React.useMemo<BlurRenderMode>(() => {
    if (renderMode === "static" || renderMode === "webgl") {
      return renderMode
    }
    return resolveBlurRenderModeFromWindowState({
      blur,
      width,
      height,
    })
  }, [blur, height, renderMode, width])
  const shouldUseWebgl = resolvedRenderMode === "webgl"
  const releaseResources = React.useCallback((options?: { loseContext?: boolean }) => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    if (notifyFrameRef.current !== null) {
      window.cancelAnimationFrame(notifyFrameRef.current)
      notifyFrameRef.current = null
    }
    if (resourcesRef.current) {
      destroyResources(resourcesRef.current, options)
      resourcesRef.current = null
    }
    resetCanvasBackbuffer(canvasRef.current)
  }, [])

  const scheduleFrameRenderedNotification = React.useCallback(() => {
    if (!onFrameRendered) {
      return
    }

    if (notifyFrameRef.current !== null) {
      window.cancelAnimationFrame(notifyFrameRef.current)
    }

    notifyFrameRef.current = window.requestAnimationFrame(() => {
      notifyFrameRef.current = window.requestAnimationFrame(() => {
        notifyFrameRef.current = null
        onFrameRendered()
      })
    })
  }, [onFrameRendered])

  React.useEffect(() => {
    if (!src) {
      imageRef.current = null
      setFallbackMode(false)
      setImageReadyKey(null)
      return
    }

    let cancelled = false
    setFallbackMode(false)
    const image = new Image()
    image.decoding = "async"
    image.src = src

    const markReady = () => {
      if (cancelled) {
        return
      }
      imageRef.current = image
      setImageReadyKey(`${src}:${image.naturalWidth}x${image.naturalHeight}`)
    }

    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      markReady()
      return () => {
        cancelled = true
      }
    }

    image.onload = markReady
    image.onerror = () => {
      if (cancelled) {
        return
      }
      imageRef.current = null
      setImageReadyKey(null)
    }

    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [src])

  React.useEffect(() => {
    return () => {
      imageRef.current = null
      releaseResources({ loseContext: true })
    }
  }, [releaseResources])

  React.useEffect(() => {
    if (blur <= 0 || !shouldUseWebgl) {
      releaseResources()
      return
    }

    if (!src || !imageRect || width <= 0 || height <= 0 || !imageReadyKey) {
      return
    }

    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const render = () => {
      frameRef.current = null

      try {
        let resources = resourcesRef.current
        if (!resources) {
          const gl = canvas.getContext("webgl", {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            preserveDrawingBuffer: false,
            premultipliedAlpha: true,
            powerPreference: "high-performance",
          })

          if (!gl) {
            setFallbackMode(true)
            return
          }

          resources = createResources(gl)
          resourcesRef.current = resources
        }

        const { gl } = resources
        const pixelRatio = clamp(window.devicePixelRatio || 1, 1, pixelRatioCap)
        const outputWidth = Math.max(1, Math.round(width * pixelRatio))
        const outputHeight = Math.max(1, Math.round(height * pixelRatio))

        if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
          canvas.width = outputWidth
          canvas.height = outputHeight
        }

        const image = imageRef.current
        if (!image) {
          return
        }

        if (resources.uploadedSourceKey !== imageReadyKey) {
          gl.bindTexture(gl.TEXTURE_2D, resources.sourceTexture)
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
          )
          gl.bindTexture(gl.TEXTURE_2D, null)
          resources.uploadedSourceKey = imageReadyKey
        }

        const workingScale = getWorkingScale(outputWidth, outputHeight, blur, quality)
        const workWidth = Math.max(1, Math.round(outputWidth * workingScale))
        const workHeight = Math.max(1, Math.round(outputHeight * workingScale))
        const sceneTarget = ensureRenderTarget(gl, resources.renderTargets[0], workWidth, workHeight)
        const blurTarget = ensureRenderTarget(gl, resources.renderTargets[1], workWidth, workHeight)

        resources.renderTargets[0] = sceneTarget
        resources.renderTargets[1] = blurTarget

        const scaledImageRect = {
          left: imageRect.left * pixelRatio * workingScale,
          top: imageRect.top * pixelRatio * workingScale,
          width: imageRect.width * pixelRatio * workingScale,
          height: imageRect.height * pixelRatio * workingScale,
        }

        gl.disable(gl.DEPTH_TEST)
        gl.disable(gl.CULL_FACE)
        gl.disable(gl.BLEND)
        gl.clearColor(0, 0, 0, 0)

        bindQuad(gl, resources.sceneProgram, resources.quadBuffer)
        gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer)
        gl.viewport(0, 0, workWidth, workHeight)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, resources.sourceTexture)
        gl.uniform1i(resources.sceneProgram.imageSamplerLocation, 0)
        gl.uniform2f(resources.sceneProgram.canvasSizeLocation, workWidth, workHeight)
        gl.uniform4f(
          resources.sceneProgram.imageRectLocation,
          scaledImageRect.left,
          scaledImageRect.top,
          scaledImageRect.width,
          scaledImageRect.height,
        )
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        const workBlurInPixels = blur * pixelRatio * workingScale
        const blurPlan = getBlurPassPlan(workBlurInPixels)

        if (blurPlan.iterations > 0) {
          bindQuad(gl, resources.blurProgram, resources.quadBuffer)
          gl.uniform2f(resources.blurProgram.texelSizeLocation, 1 / workWidth, 1 / workHeight)
          gl.uniform1f(resources.blurProgram.radiusLocation, blurPlan.radius)

          for (let index = 0; index < blurPlan.iterations; index += 1) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, blurTarget.framebuffer)
            gl.viewport(0, 0, workWidth, workHeight)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, sceneTarget.texture)
            gl.uniform1i(resources.blurProgram.textureSamplerLocation, 0)
            gl.uniform2f(resources.blurProgram.directionLocation, 1, 0)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

            gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer)
            gl.viewport(0, 0, workWidth, workHeight)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.bindTexture(gl.TEXTURE_2D, blurTarget.texture)
            gl.uniform2f(resources.blurProgram.directionLocation, 0, 1)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          }
        }

        bindQuad(gl, resources.copyProgram, resources.quadBuffer)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, outputWidth, outputHeight)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, sceneTarget.texture)
        gl.uniform1i(resources.copyProgram.textureSamplerLocation, 0)
        gl.uniform2f(resources.copyProgram.canvasSizeLocation, outputWidth, outputHeight)
        gl.uniform4f(
          resources.copyProgram.imageRectLocation,
          imageRect.left * pixelRatio,
          imageRect.top * pixelRatio,
          imageRect.width * pixelRatio,
          imageRect.height * pixelRatio,
        )
        gl.uniform1f(resources.copyProgram.cropToImageRectLocation, cropToImageRect ? 1 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        scheduleFrameRenderedNotification()
      } catch {
        releaseResources({ loseContext: true })
        setFallbackMode(true)
      }
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
    }
    frameRef.current = window.requestAnimationFrame(render)

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [
    blur,
    height,
    imageReadyKey,
    imageRect,
    pixelRatioCap,
    quality,
    cropToImageRect,
    shouldUseWebgl,
    releaseResources,
    scheduleFrameRenderedNotification,
    src,
    width,
  ])

  React.useEffect(() => {
    if (!src || !imageRect || width <= 0 || height <= 0) {
      return
    }

    if (!fallbackMode && blur > 0 && shouldUseWebgl) {
      return
    }

    scheduleFrameRenderedNotification()
  }, [blur, fallbackMode, height, imageRect, scheduleFrameRenderedNotification, shouldUseWebgl, src, width])

  if (!src || !imageRect || width <= 0 || height <= 0) {
    return null
  }

  if (fallbackMode || blur <= 0 || !shouldUseWebgl) {
    const imageStyle = {
      left: `${imageRect.left}px`,
      top: `${imageRect.top}px`,
      width: `${imageRect.width}px`,
      height: `${imageRect.height}px`,
      filter: blur > 0 ? `blur(${blur}px)` : undefined,
    }

    return (
      <div
        aria-hidden="true"
        className={cn(className, "absolute select-none")}
        style={{
          ...style,
          width: `${width}px`,
          height: `${height}px`,
          opacity,
        }}
      >
        {cropToImageRect && blur > 0 ? (
          <div
            className="absolute overflow-hidden"
            style={{
              left: imageStyle.left,
              top: imageStyle.top,
              width: imageStyle.width,
              height: imageStyle.height,
            }}
          >
            <img
              alt=""
              src={src}
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                filter: imageStyle.filter,
              }}
            />
          </div>
        ) : (
          <img
            alt=""
            src={src}
            draggable={false}
            className="absolute max-w-none select-none"
            style={imageStyle}
          />
        )}
      </div>
    )
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(className)}
      style={{
        ...style,
        width: `${width}px`,
        height: `${height}px`,
        opacity,
      }}
    />
  )
}
