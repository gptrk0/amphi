import { PrismaClient } from "../../prisma/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Prisma 7 requires a driver adapter at runtime; the url in prisma.config.ts is CLI only.
export const prisma = globalForPrisma.prisma || new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
