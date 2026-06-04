/**
 * Domains — Domain-Driven Design layer.
 *
 * Each domain aggregates its own types, repository, and service.
 * Services delegate to existing lib/ implementations to maintain
 * backward compatibility with the Agent Pipeline.
 *
 * Usage:
 *   import { CustomerService } from "@/domains/customer";
 *   import { CaseService } from "@/domains/case";
 *
 * Or bulk-import:
 *   import { CustomerService, CaseService, ProductService } from "@/domains";
 */

export * from "./customer";
export * from "./order";
export * from "./ticket";
export * from "./case";
export * from "./product";
export * from "./knowledge";
