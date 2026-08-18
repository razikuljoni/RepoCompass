import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { analysisQueueRuntime } from "../lib/runtime/analysis-queue.ts";

const worker: ExportedHandler<Cloudflare.Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image" && env.ASSETS && env.IMAGES) {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format: format as "image/avif" | "image/webp", quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
  async queue(batch, env): Promise<void> {
    console.log("[WORKER QUEUE HANDLER RECEIVED BATCH]", batch?.messages?.length);
    try {
      await analysisQueueRuntime.consume(batch, env);
      console.log("[WORKER QUEUE HANDLER CONSUMED OK]");
    } catch (err) {
      console.error("[WORKER QUEUE HANDLER ERROR]", err);
      throw err;
    }
  },
};

export default worker;
