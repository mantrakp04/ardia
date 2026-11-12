export interface Event {
  t: number;
  x?: number;
  y?: number;
  down?: number;
  up?: number;
  hide?: number;
  mark?: string;
}

export interface Overlay {
  file: string;
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  until?: number;
}

export interface Note {
  t: number;
  until?: number;
  x: number;
  y: number;
  text: string;
}

export interface Dialog {
  t: number;
  until: number;
  press: number;
  x: number;
  y: number;
  icon?: boolean;
  title: string;
  message: string;
  confirmTitle: string;
  cancelTitle: string;
  suppression?: string;
}

export interface Banner {
  t: number;
  title: string;
  body: string;
  subtitle: string;
  silent: boolean;
}

export interface MenuItem {
  title?: string;
  symbol?: string;
  checked?: boolean;
  separator?: boolean;
  children?: MenuItem[];
}

export interface MenuGeometry {
  x: number;
  y: number;
  subX: number;
  subY: number;
  width: number;
  subWidth: number;
  row: number;
  separator: number;
  pad: number;
}

export interface Menu {
  t: number;
  until: number;
  sub: number | null;
  geometry: MenuGeometry;
  items: MenuItem[];
}

export interface PageGone {
  t: number;
  text: string;
}

export interface WindowGone {
  t: number;
  until: number;
  reopen: number;
}

export type Gone = PageGone | WindowGone;

export interface Clip {
  file?: string;
  still?: string;
  overlays?: Overlay[];
  dialogs?: Dialog[];
  banners?: Banner[];
  notes?: Note[];
  menus?: Menu[];
  gone?: Gone;
  w: number;
  h: number;
  scale: number;
  inS: number;
  outS: number;
  events: Event[];
}

export interface Segment {
  scene: string;
  title: string;
  body: string;
  layout?: "side" | "stack";
  cam: number[];
  zoom?: { cam: number[]; from: number; to: number };
  length: number;
  rate?: number;
  afterVersion?: string;
  beforeVersion?: string;
  note?: string;
  cursor?: boolean;
  afterOnly?: string;
  before?: Clip;
  after: Clip;
}

export type Pointer = { x: number; y: number; pressed: boolean } | null;

export type Cam = [number, number];
