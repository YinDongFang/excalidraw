import rough from "roughjs/bin/rough";
import { NonDeletedExcalidrawElement, Theme } from "../element/types";
import { getCommonBounds } from "../element/bounds";
import { renderScene, renderSceneToSvg } from "../renderer/renderScene";
import { distance } from "../utils";
import { AppState, BinaryFiles } from "../types";
import { DEFAULT_EXPORT_PADDING, SVG_NS, THEME_FILTER } from "../constants";
import { getDefaultAppState } from "../appState";
import { serializeAsJSON } from "../data/json";
import {
  getInitializedImageElements,
  updateImageCache,
} from "../element/image";
import { restoreAppState } from "../data/restore";

export const SVG_EXPORT_TAG = `<!-- svg-source:excalidraw -->`;

export const exportToCanvas = async (data: {
  elements: readonly NonDeletedExcalidrawElement[];
  appState?: Partial<Omit<AppState, "offsetTop" | "offsetLeft">>;
  files: BinaryFiles | null;
  opts?: {
    theme?: Theme;
    exportBackground?: boolean;
    exportPadding?: number;
    viewBackgroundColor?: string;
    // -------------------------------------------------------------------------
    /**
     * Makes sure the canvas is no larger than this value, while keeping the
     * aspect ratio.
     */
    maxWidthOrHeight?: number;
    // -------------------------------------------------------------------------
    /**
     * Width of the frame. Supply `x` or `y` if you want to ofsset
     * the start.
     */
    width?: number;
    /**
     * Height of the frame.
     *
     * If height omitted, it's calculated from `width` based on the aspect
     * ratio.
     */
    height?: number;
    /** x-position start */
    x?: number;
    /** y-position start */
    y?: number;
    // -------------------------------------------------------------------------
    /**
     * A multiplier to increase/decrease the canvas resolution.
     *
     * For example, if your canvas is 300x150 and you set scale to 2, the
     * resoluting size will be 600x300.
     *
     * Ignored if `maxWidthOrHeight` is set.
     *
     * @default 1
     */
    scale?: number;
    /**
     * If you need to suply your own canvas, e.g. in test environments or on
     * Node.js.
     *
     * Do not set canvas.width/height or modify the context as that's handled
     * by Excalidraw.
     */
    createCanvas?: (
      // FIXME remove these params
      width: number,
      height: number,
    ) => HTMLCanvasElement;
    /**
     * If you want to supply width/height dynamically, or based on actual
     * canvas size (all elements' bounding box).
     *
     * Ignored if `maxWidthOrHeight` or `width` is set.
     */
    getDimensions?: (
      width: number,
      height: number,
    ) => { width: number; height: number; scale?: number };
  };
}) => {
  const { opts, elements, files } = data;

  const defaultAppState = getDefaultAppState();

  const appState = restoreAppState(data.appState, null);

  const exportBackground = opts?.exportBackground ?? true;
  const exportPadding = opts?.exportPadding ?? DEFAULT_EXPORT_PADDING;
  const viewBackgroundColor =
    opts?.viewBackgroundColor || appState.viewBackgroundColor || "#fff";

  let canvasScale = opts?.scale ?? 1;

  const canvasSize = getCanvasSize(elements, exportPadding);
  let [scrollX, scrollY, width, height] = canvasSize;

  if (opts?.maxWidthOrHeight) {
    canvasScale =
      opts.maxWidthOrHeight / Math.max(canvasSize[2], canvasSize[3]);

    width *= canvasScale;
    height *= canvasScale;
  } else if (opts?.width) {
    scrollX = 0;
    width = opts.width;

    scrollY = 0;
    if (opts?.height) {
      height = opts.height;
    } else {
      // calculate height using the same aspect ratio as the whole canvas
      height = width * (canvasSize[3] / canvasSize[2]);
    }

    width *= canvasScale;
    height *= canvasScale;
  } else {
    [scrollX, scrollY, width, height] = canvasSize;

    if (opts?.getDimensions) {
      const {
        width: newWidth,
        height: newHeight,
        scale,
      } = opts.getDimensions(width, height);
      width = newWidth;
      height = newHeight;
      if (scale) {
        scrollX *= scale;
        scrollY *= scale;
      }
    }
  }

  if (opts?.x) {
    scrollX = opts.x;
  }
  if (opts?.y) {
    scrollY = opts.y;
  }

  const canvas = opts?.createCanvas
    ? opts.createCanvas(width, height)
    : document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const { imageCache } = await updateImageCache({
    imageCache: new Map(),
    fileIds: getInitializedImageElements(elements).map(
      (element) => element.fileId,
    ),
    files: files || {},
  });

  renderScene({
    elements,
    appState: { ...appState, width, height, offsetLeft: 0, offsetTop: 0 },
    rc: rough.canvas(canvas),
    canvas,
    renderConfig: {
      canvasBackgroundColor: exportBackground ? viewBackgroundColor : null,
      scrollX: -scrollX + exportPadding,
      scrollY: -scrollY + exportPadding,
      canvasScale,
      zoom: defaultAppState.zoom,
      remotePointerViewportCoords: {},
      remoteSelectedElementIds: {},
      shouldCacheIgnoreZoom: false,
      remotePointerUsernames: {},
      remotePointerUserStates: {},
      theme: opts?.theme || (appState.exportWithDarkMode ? "dark" : "light"),
      imageCache,
      renderScrollbars: false,
      renderSelection: false,
      renderGrid: false,
      isExporting: true,
    },
  });

  return canvas;
};

export const exportToSvg = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: {
    exportBackground: boolean;
    exportPadding?: number;
    exportScale?: number;
    viewBackgroundColor: string;
    exportWithDarkMode?: boolean;
    exportEmbedScene?: boolean;
  },
  files: BinaryFiles | null,
): Promise<SVGSVGElement> => {
  const {
    exportPadding = DEFAULT_EXPORT_PADDING,
    viewBackgroundColor,
    exportScale = 1,
    exportEmbedScene,
  } = appState;
  let metadata = "";
  if (exportEmbedScene) {
    try {
      metadata = await (
        await import(/* webpackChunkName: "image" */ "../../src/data/image")
      ).encodeSvgMetadata({
        text: serializeAsJSON(elements, appState, files || {}, "local"),
      });
    } catch (error: any) {
      console.error(error);
    }
  }
  const [minX, minY, width, height] = getCanvasSize(elements, exportPadding);

  // initialize SVG root
  const svgRoot = document.createElementNS(SVG_NS, "svg");
  svgRoot.setAttribute("version", "1.1");
  svgRoot.setAttribute("xmlns", SVG_NS);
  svgRoot.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgRoot.setAttribute("width", `${width * exportScale}`);
  svgRoot.setAttribute("height", `${height * exportScale}`);
  if (appState.exportWithDarkMode) {
    svgRoot.setAttribute("filter", THEME_FILTER);
  }

  let assetPath = "https://excalidraw.com/";

  // Asset path needs to be determined only when using package
  if (process.env.IS_EXCALIDRAW_NPM_PACKAGE) {
    assetPath =
      window.EXCALIDRAW_ASSET_PATH ||
      `https://unpkg.com/${process.env.PKG_NAME}@${process.env.PKG_VERSION}`;

    if (assetPath?.startsWith("/")) {
      assetPath = assetPath.replace("/", `${window.location.origin}/`);
    }
    assetPath = `${assetPath}/dist/excalidraw-assets/`;
  }
  svgRoot.innerHTML = `
  ${SVG_EXPORT_TAG}
  ${metadata}
  <defs>
    <style class="style-fonts">
      @font-face {
        font-family: "Virgil";
        src: url("${assetPath}Virgil.woff2");
      }
      @font-face {
        font-family: "Cascadia";
        src: url("${assetPath}Cascadia.woff2");
      }
    </style>
  </defs>
  `;
  // render background rect
  if (appState.exportBackground && viewBackgroundColor) {
    const rect = svgRoot.ownerDocument!.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", `${width}`);
    rect.setAttribute("height", `${height}`);
    rect.setAttribute("fill", viewBackgroundColor);
    svgRoot.appendChild(rect);
  }

  const rsvg = rough.svg(svgRoot);
  renderSceneToSvg(elements, rsvg, svgRoot, files || {}, {
    offsetX: -minX + exportPadding,
    offsetY: -minY + exportPadding,
    exportWithDarkMode: appState.exportWithDarkMode,
  });

  return svgRoot;
};

// calculate smallest area to fit the contents in
const getCanvasSize = (
  elements: readonly NonDeletedExcalidrawElement[],
  exportPadding: number,
): [minX: number, minY: number, width: number, height: number] => {
  const [minX, minY, maxX, maxY] = getCommonBounds(elements);
  const width = distance(minX, maxX) + exportPadding * 2;
  const height = distance(minY, maxY) + exportPadding + exportPadding;

  return [minX, minY, width, height];
};

export const getExportSize = (
  elements: readonly NonDeletedExcalidrawElement[],
  exportPadding: number,
  scale: number,
): [number, number] => {
  const [, , width, height] = getCanvasSize(elements, exportPadding).map(
    (dimension) => Math.trunc(dimension * scale),
  );

  return [width, height];
};
