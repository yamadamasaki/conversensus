import { z } from 'zod';
import { GraphFileSchema } from './schemas';

export * from './migrations';
export * from './schemas';

// --- HTTP API request/response schemas ---
export const CreateFileRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  sheet: z.object({ name: z.string().optional() }).optional(),
});
export type CreateFileRequest = z.infer<typeof CreateFileRequestSchema>;

export const UpdateFileRequestSchema = GraphFileSchema;
export type UpdateFileRequest = z.infer<typeof UpdateFileRequestSchema>;
