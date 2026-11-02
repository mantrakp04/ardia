export class Program {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly handle: WebGLProgram,
  ) {}

  use() {
    this.gl.useProgram(this.handle);
    return this;
  }

  private at(name: string) {
    let location = this.locations.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(this.handle, name);
      this.locations.set(name, location);
    }
    return location;
  }

  float(name: string, value: number) {
    this.gl.uniform1f(this.at(name), value);
    return this;
  }

  vec2(name: string, x: number, y: number) {
    this.gl.uniform2f(this.at(name), x, y);
    return this;
  }

  vec3(name: string, value: ArrayLike<number>) {
    this.gl.uniform3f(this.at(name), value[0], value[1], value[2]);
    return this;
  }

  vec4(name: string, x: number, y: number, z: number, w: number) {
    this.gl.uniform4f(this.at(name), x, y, z, w);
    return this;
  }

  vec4s(name: string, values: Float32Array, count: number) {
    if (count > 0) this.gl.uniform4fv(this.at(name), values, 0, count * 4);
    return this;
  }

  ivec2(name: string, x: number, y: number) {
    this.gl.uniform2i(this.at(name), x, y);
    return this;
  }

  int(name: string, value: number) {
    this.gl.uniform1i(this.at(name), value);
    return this;
  }

  mat4(name: string, value: Float32Array) {
    this.gl.uniformMatrix4fv(this.at(name), false, value);
    return this;
  }
}

interface PendingProgram {
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
}

export class ProgramBatch<Name extends string> {
  private readonly pending = new Map<Name, PendingProgram>();
  private readonly parallel: { COMPLETION_STATUS_KHR: number } | null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    sources: Record<Name, [string, string]>,
  ) {
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
    for (const name of Object.keys(sources) as Name[]) {
      const [vertexSource, fragmentSource] = sources[name];
      const vertex = this.compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = this.compile(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram()!;
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      this.pending.set(name, { program, vertex, fragment });
    }
  }

  private compile(type: number, source: string) {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    return shader;
  }

  get ready() {
    if (!this.parallel) return true;
    for (const { program } of this.pending.values()) {
      if (!this.gl.getProgramParameter(program, this.parallel.COMPLETION_STATUS_KHR)) return false;
    }
    return true;
  }

  finish(): Record<Name, Program> {
    const { gl } = this;
    const programs = {} as Record<Name, Program>;
    for (const [name, { program, vertex, fragment }] of this.pending) {
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = [gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment), gl.getProgramInfoLog(program)]
          .filter(Boolean)
          .join("\n");
        throw new Error(`meadow ${name}: ${log}`);
      }
      gl.detachShader(program, vertex);
      gl.detachShader(program, fragment);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      programs[name] = new Program(gl, program);
    }
    return programs;
  }
}

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number = gl.RGBA8,
  format: number = gl.RGBA,
  type: number = gl.UNSIGNED_BYTE,
) {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function createFramebuffer(gl: WebGL2RenderingContext, textures: WebGLTexture[]) {
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  textures.forEach((texture, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
  });
  gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  return framebuffer;
}

export function bindTexture(gl: WebGL2RenderingContext, unit: number, texture: WebGLTexture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}
