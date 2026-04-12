import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { createImageService } from "../images/imageService.js";
import { scanImages } from "../images/scanImages.js";

const scanBodySchema = z.object({
  imageDir: z.string().min(1),
});

const bindBodySchema = z.object({
  templateId: z.string().min(1),
});

export const imageRoutes: FastifyPluginAsync = async (app) => {
  const imageService = createImageService();

  app.get("/images", async () => ({ images: await imageService.listImages() }));

  app.post("/images/upload", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: "File is required" });
    }

    const image = await imageService.uploadImage({
      fileName: file.filename,
      content: await file.toBuffer(),
    });
    return reply.code(201).send({ image });
  });

  app.post("/images/scan", async (request, reply) => {
    const body = scanBodySchema.parse(request.body);
    const images = await scanImages(body.imageDir);
    return reply.send({ images });
  });

  app.post("/images/:imageId/bind-template", async (request, reply) => {
    const params = z
      .object({ imageId: z.string().min(1) })
      .parse(request.params);
    const body = bindBodySchema.parse(request.body);
    const image = await imageService.bindImageToTemplate(
      params.imageId,
      body.templateId,
    );

    if (!image) {
      return reply.code(404).send({ message: "Image not found" });
    }

    return reply.send({ image });
  });

  app.delete("/images/:imageId/template-binding", async (request, reply) => {
    const params = z
      .object({ imageId: z.string().min(1) })
      .parse(request.params);
    const image = await imageService.unbindImageFromTemplate(params.imageId);

    if (!image) {
      return reply.code(404).send({ message: "Image not found" });
    }

    return reply.send({ image });
  });

  app.delete("/images/:imageId/file", async (request, reply) => {
    const params = z
      .object({ imageId: z.string().min(1) })
      .parse(request.params);
    const image = await imageService.deleteImageFile(params.imageId);

    if (!image) {
      return reply.code(404).send({ message: "Image not found" });
    }

    return reply.send({ image });
  });

  app.delete("/images/:imageId", async (request, reply) => {
    const params = z
      .object({ imageId: z.string().min(1) })
      .parse(request.params);
    const image = await imageService.removeImageFromCatalog(params.imageId);

    if (!image) {
      return reply.code(404).send({ message: "Image not found" });
    }

    return reply.send({ image });
  });
};
