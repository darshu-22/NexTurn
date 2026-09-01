import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const QueueCreateSchema = z.object({
  name: z.string().min(2),
});

export const JoinQueueSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().optional(),
});

export const ReorderQueueSchema = z.object({
  targetPosition: z.number().int().min(1, "Target position must be at least 1"),
});
