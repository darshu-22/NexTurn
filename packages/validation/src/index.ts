import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const SignupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  tenantSlug: z.string().optional(),
});

export const CreateAdminSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email(),
  phone: z.string().optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const QueueCreateSchema = z.object({
  name: z.string().min(2),
});

export const JoinQueueSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().optional(),
});

export const ReorderQueueSchema = z.object({
  targetPosition: z.number().int().min(1, "Target position must be at least 1"),
});
