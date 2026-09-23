import type { Phase } from "../value-objects/Phase";
import type { Moment } from "./Moment";

/**
 * History Operation Types
 *
 * Defines all tracked operations for undo/redo functionality.
 * Operations are grouped into logical transactions for better UX.
 */
export type HistoryOperationType =
  // Moment CRUD
  | "CREATE_MOMENT"
  | "UPDATE_MOMENT"
  | "DELETE_MOMENT"
  | "BULK_DELETE_MOMENTS"

  // Allocation
  | "ALLOCATE_MOMENT"
  | "UNALLOCATE_MOMENT"
  | "MOVE_MOMENT" // Combined unallocate + allocate (drag & drop)
  | "DUPLICATE_MOMENT"
  | "REORDER_MOMENTS" // Within same cell

  // Selection
  | "SELECT_MOMENTS"
  | "DESELECT_MOMENTS"
  | "CLEAR_SELECTION"
  | "SELECT_ALL";

/**
 * Base history operation
 */
export interface BaseHistoryOperation {
  type: HistoryOperationType;
  timestamp: number; // Unix timestamp in milliseconds
}

/**
 * Create moment operation
 */
export interface CreateMomentOperation extends BaseHistoryOperation {
  type: "CREATE_MOMENT";
  moment: Moment;
}

/**
 * Update moment operation (name or area change)
 */
export interface UpdateMomentOperation extends BaseHistoryOperation {
  type: "UPDATE_MOMENT";
  momentId: string;
  before: Partial<Moment>; // Previous state
  after: Partial<Moment>; // New state
}

/**
 * Delete moment operation
 */
export interface DeleteMomentOperation extends BaseHistoryOperation {
  type: "DELETE_MOMENT";
  moment: Moment; // Store full moment for undo
}

/**
 * Bulk delete moments operation
 */
export interface BulkDeleteMomentsOperation extends BaseHistoryOperation {
  type: "BULK_DELETE_MOMENTS";
  moments: Moment[]; // Store all deleted moments for undo
}

/**
 * Allocate moment to day/phase
 */
export interface AllocateMomentOperation extends BaseHistoryOperation {
  type: "ALLOCATE_MOMENT";
  momentId: string;
  day: string;
  phase: Phase;
  order: number;
}

/**
 * Unallocate moment (return to drawing board)
 */
export interface UnallocateMomentOperation extends BaseHistoryOperation {
  type: "UNALLOCATE_MOMENT";
  momentId: string;
  previousDay: string;
  previousPhase: Phase;
  previousOrder: number;
}

/**
 * Move moment (grouped operation: unallocate + allocate)
 * This is the primary operation for drag & drop
 */
export interface MoveMomentOperation extends BaseHistoryOperation {
  type: "MOVE_MOMENT";
  momentId: string;
  fromDay: string | null;
  fromPhase: Phase | null;
  fromOrder: number;
  toDay: string | null;
  toPhase: Phase | null;
  toOrder: number;
  // Additional moments that were reordered in source/target cells
  reorders?: Array<{ momentId: string; fromOrder: number; toOrder: number }>;
}

/**
 * Duplicate moment
 */
export interface DuplicateMomentOperation extends BaseHistoryOperation {
  type: "DUPLICATE_MOMENT";
  originalMomentId: string;
  duplicatedMoment: Moment; // Store full duplicated moment
}

/**
 * Reorder moments within same cell
 */
export interface ReorderMomentsOperation extends BaseHistoryOperation {
  type: "REORDER_MOMENTS";
  day: string;
  phase: Phase;
  reorders: Array<{ momentId: string; fromOrder: number; toOrder: number }>;
}

/**
 * Selection operations
 */
export interface SelectMomentsOperation extends BaseHistoryOperation {
  type: "SELECT_MOMENTS";
  momentIds: string[];
  previousSelection: string[];
}

export interface DeselectMomentsOperation extends BaseHistoryOperation {
  type: "DESELECT_MOMENTS";
  momentIds: string[];
  previousSelection: string[];
}

export interface ClearSelectionOperation extends BaseHistoryOperation {
  type: "CLEAR_SELECTION";
  previousSelection: string[];
}

export interface SelectAllOperation extends BaseHistoryOperation {
  type: "SELECT_ALL";
  momentIds: string[];
  previousSelection: string[];
}

/**
 * Union of all history operations
 */
export type HistoryOperation =
  | CreateMomentOperation
  | UpdateMomentOperation
  | DeleteMomentOperation
  | BulkDeleteMomentsOperation
  | AllocateMomentOperation
  | UnallocateMomentOperation
  | MoveMomentOperation
  | DuplicateMomentOperation
  | ReorderMomentsOperation
  | SelectMomentsOperation
  | DeselectMomentsOperation
  | ClearSelectionOperation
  | SelectAllOperation;

/**
 * A history entry can contain multiple operations (for batched/grouped operations)
 * Example: Multi-select + bulk delete = 1 entry with 2 operations
 */
export interface HistoryEntry {
  id: string; // UUID
  operations: HistoryOperation[]; // One or more operations
  timestamp: number; // Unix timestamp in milliseconds
  description: string; // Human-readable description (for future history panel)
}

/**
 * History state
 */
export interface HistoryState {
  past: HistoryEntry[]; // Undo stack
  future: HistoryEntry[]; // Redo stack
  currentBatch: HistoryOperation[]; // Operations being batched
  isBatching: boolean; // Whether we're currently batching operations
}

/**
 * Create a history entry from one or more operations
 */
export function createHistoryEntry(
  operations: HistoryOperation | HistoryOperation[],
  description?: string,
): HistoryEntry {
  const ops = Array.isArray(operations) ? operations : [operations];

  return {
    id: crypto.randomUUID(),
    operations: ops,
    timestamp: Date.now(),
    description: description || generateDescription(ops),
  };
}

/**
 * Generate a human-readable description from operations
 */
function generateDescription(operations: HistoryOperation[]): string {
  if (operations.length === 0) {
    return "Unknown operation";
  }

  if (operations.length === 1) {
    const op = operations[0];
    switch (op.type) {
      case "CREATE_MOMENT":
        return `Created "${op.moment.name}"`;
      case "UPDATE_MOMENT":
        return "Updated moment";
      case "DELETE_MOMENT":
        return `Deleted "${op.moment.name}"`;
      case "BULK_DELETE_MOMENTS":
        return `Deleted ${op.moments.length} moments`;
      case "ALLOCATE_MOMENT":
        return "Tended moment";
      case "UNALLOCATE_MOMENT":
        return "Set aside moment";
      case "MOVE_MOMENT":
        return "Moved moment";
      case "DUPLICATE_MOMENT":
        return `Duplicated "${op.duplicatedMoment.name}"`;
      case "REORDER_MOMENTS":
        return `Reordered ${op.reorders.length} moments`;
      case "SELECT_MOMENTS":
        return `Selected ${op.momentIds.length} moments`;
      case "DESELECT_MOMENTS":
        return `Deselected ${op.momentIds.length} moments`;
      case "CLEAR_SELECTION":
        return "Cleared selection";
      case "SELECT_ALL":
        return `Selected all ${op.momentIds.length} moments`;
      default:
        return "Unknown operation";
    }
  }

  // Multiple operations - summarize
  const types = new Set(operations.map((op) => op.type));
  if (types.size === 1) {
    return `${operations.length} ${operations[0].type
      .toLowerCase()
      .replace(/_/g, " ")} operations`;
  }

  return `${operations.length} operations`;
}

/**
 * Get the inverse operation for undo
 * Returns null if the operation cannot be undone
 */
export function getInverseOperation(
  operation: HistoryOperation,
): HistoryOperation | null {
  switch (operation.type) {
    case "CREATE_MOMENT":
      return {
        type: "DELETE_MOMENT",
        timestamp: Date.now(),
        moment: operation.moment,
      };

    case "DELETE_MOMENT":
      return {
        type: "CREATE_MOMENT",
        timestamp: Date.now(),
        moment: operation.moment,
      };

    case "BULK_DELETE_MOMENTS":
      // Recreate all deleted moments
      return {
        type: "CREATE_MOMENT",
        timestamp: Date.now(),
        moment: operation.moments[0], // Will need to handle multiple creates
      };

    case "UPDATE_MOMENT":
      return {
        type: "UPDATE_MOMENT",
        timestamp: Date.now(),
        momentId: operation.momentId,
        before: operation.after, // Swap before/after
        after: operation.before,
      };

    case "ALLOCATE_MOMENT":
      return {
        type: "UNALLOCATE_MOMENT",
        timestamp: Date.now(),
        momentId: operation.momentId,
        previousDay: operation.day,
        previousPhase: operation.phase,
        previousOrder: operation.order,
      };

    case "UNALLOCATE_MOMENT":
      return {
        type: "ALLOCATE_MOMENT",
        timestamp: Date.now(),
        momentId: operation.momentId,
        day: operation.previousDay,
        phase: operation.previousPhase,
        order: operation.previousOrder,
      };

    case "MOVE_MOMENT":
      return {
        type: "MOVE_MOMENT",
        timestamp: Date.now(),
        momentId: operation.momentId,
        fromDay: operation.toDay, // Swap from/to
        fromPhase: operation.toPhase,
        fromOrder: operation.toOrder,
        toDay: operation.fromDay,
        toPhase: operation.fromPhase,
        toOrder: operation.fromOrder,
        reorders: operation.reorders?.map((r) => ({
          momentId: r.momentId,
          fromOrder: r.toOrder, // Swap orders
          toOrder: r.fromOrder,
        })),
      };

    case "DUPLICATE_MOMENT":
      // Undo duplicate = delete the duplicate
      return {
        type: "DELETE_MOMENT",
        timestamp: Date.now(),
        moment: operation.duplicatedMoment,
      };

    case "REORDER_MOMENTS":
      return {
        type: "REORDER_MOMENTS",
        timestamp: Date.now(),
        day: operation.day,
        phase: operation.phase,
        reorders: operation.reorders.map((r) => ({
          momentId: r.momentId,
          fromOrder: r.toOrder, // Swap orders
          toOrder: r.fromOrder,
        })),
      };

    case "SELECT_MOMENTS":
      return {
        type: "SELECT_MOMENTS",
        timestamp: Date.now(),
        momentIds: operation.previousSelection,
        previousSelection: operation.momentIds,
      };

    case "DESELECT_MOMENTS":
      return {
        type: "SELECT_MOMENTS",
        timestamp: Date.now(),
        momentIds: operation.momentIds,
        previousSelection: operation.previousSelection,
      };

    case "CLEAR_SELECTION":
      return {
        type: "SELECT_MOMENTS",
        timestamp: Date.now(),
        momentIds: operation.previousSelection,
        previousSelection: [],
      };

    case "SELECT_ALL":
      return {
        type: "SELECT_MOMENTS",
        timestamp: Date.now(),
        momentIds: operation.previousSelection,
        previousSelection: operation.momentIds,
      };

    default:
      return null;
  }
}
