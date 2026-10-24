import { z } from "zod";

export const PhoneSchema = z
  .string()
  .trim()
  .max(20, "Phone number cannot exceed 20 characters")
  .regex(/^(\+?[0-9\s\-()]{7,20})?$/, "Invalid phone number format")
  .optional()
  .or(z.literal(""));

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const SignupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  phone: PhoneSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
  tenantSlug: z.string().optional(),
});

export const CreateAdminSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  phone: PhoneSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const QueueCreateSchema = z.object({
  name: z.string().trim().min(2, "Queue name must be at least 2 characters"),
});

export const JoinQueueSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .optional(),
  phone: PhoneSchema,
});

export const ReorderQueueSchema = z.object({
  targetPosition: z.number().int().min(1, "Target position must be at least 1"),
});
