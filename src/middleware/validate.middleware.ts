// File: backend/src/middleware/validate.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

export const validateSchema =
  (schema: z.ZodSchema) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: 'Error de validación de datos',
          errors: error.issues.map((issue) => ({
            field: issue.path.join('.').replace(/^(body|query|params)\./, ''),
            message: issue.message,
          })),
        });
        return;
      }
      next(error);
    }
  };