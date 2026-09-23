import { normalizeTags } from "../services/TagService.ts";
import type { Attitude } from "../value-objects/Attitude";
import type { Moment } from "./Moment";

/**
 * Area - Life domain categorization for moments
 *
 * Areas represent different aspects of life (Wellness, Craft, Social, etc.)
 * Each area has a color and emoji for visual identification.
 */
export interface AreaSurfaces {
  readonly paths?: readonly string[];
  readonly hosts?: readonly string[];
  readonly apps?: readonly string[];
}

export interface Area {
  readonly id: string;
  name: string;
  attitude: Attitude | null;
  tags: string[];
  color: string;
  /** User-owned. Empty means none chosen; the area colour stands in. */
  emoji: string;
  isDefault: boolean;
  surfaces?: AreaSurfaces;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result type for operations that may fail
 */
export type AreaResult = Area | { error: string };

/**
 * Default area definitions
 */
export const DEFAULT_AREAS: Omit<Area, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "Wellness",
    attitude: null,
    tags: [],
    color: "#10b981",
    emoji: "🧘",
    isDefault: true,
    order: 0,
  },
  {
    name: "Craft",
    attitude: null,
    tags: [],
    color: "#3b82f6",
    emoji: "🎨",
    isDefault: true,
    order: 1,
  },
  {
    name: "Social",
    attitude: null,
    tags: [],
    color: "#f97316",
    emoji: "🤝",
    isDefault: true,
    order: 2,
  },
  {
    name: "Joyful",
    attitude: null,
    tags: [],
    color: "#eab308",
    emoji: "😄",
    isDefault: true,
    order: 3,
  },
  {
    name: "Introspective",
    attitude: null,
    tags: [],
    color: "#6b7280",
    emoji: "🤔",
    isDefault: true,
    order: 4,
  },
  {
    name: "Chore",
    attitude: null,
    tags: [],
    color: "#8b5cf6",
    emoji: "🧹",
    isDefault: true,
    order: 5,
  },
];

/**
 * Creates the 5 default areas with generated IDs and timestamps
 *
 * @returns Array of default areas
 */
export function getDefaultAreas(): Area[] {
  const now = new Date().toISOString();

  return DEFAULT_AREAS.map((area) => ({
    ...area,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Props for creating an area
 */
export type CreateAreaProps = Pick<
  Area,
  "name" | "color" | "emoji" | "order"
> & {
  attitude?: Attitude | null;
  tags?: string[];
};

/**
 * Creates a new custom area
 *
 * @param props - Area creation parameters
 * @returns New area or error if validation fails
 */
export function createArea(props: CreateAreaProps): AreaResult {
  const { name, color, emoji, order, attitude = null, tags = [] } = props;
  const trimmedName = name.trim();

  if (!trimmedName) {
    return { error: "Area name cannot be empty" };
  }

  if (!color.match(/^#[0-9a-fA-F]{6}$/)) {
    return { error: "Color must be a valid hex code (e.g., #10b981)" };
  }

  if (order < 0) {
    return { error: "Order must be non-negative" };
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    name: trimmedName,
    attitude,
    tags: normalizeTags(tags),
    color: color.toLowerCase(),
    emoji: emoji.trim(),
    isDefault: false,
    order,
    createdAt: now,
    updatedAt: now,
  };
}

export type UpdateAreaProps = Partial<
  Omit<Area, "id" | "isDefault" | "createdAt" | "updatedAt">
>;

/**
 * Updates an area's properties
 *
 * @param area - Area to update
 * @param updates - Partial area properties to update
 * @returns Updated area or error
 */
export function updateArea(area: Area, updates: UpdateAreaProps): AreaResult {
  if (updates.name !== undefined) {
    const trimmedName = updates.name.trim();
    if (!trimmedName) {
      return { error: "Area name cannot be empty" };
    }
  }

  if (updates.color !== undefined) {
    if (!updates.color.match(/^#[0-9a-fA-F]{6}$/)) {
      return { error: "Color must be a valid hex code (e.g., #10b981)" };
    }
  }

  if (updates.order !== undefined) {
    if (updates.order < 0) {
      return { error: "Order must be non-negative" };
    }
  }

  return {
    ...area,
    ...updates,
    name: updates.name ? updates.name.trim() : area.name,
    color: updates.color ? updates.color.toLowerCase() : area.color,
    emoji: updates.emoji !== undefined ? updates.emoji.trim() : area.emoji,
    tags: updates.tags ? normalizeTags(updates.tags) : area.tags,
    updatedAt: new Date().toISOString(),
  };
}

export function hasAreaMoments(area: Area, moments: Moment[]): boolean {
  return moments.some((moment) => moment.areaId === area.id);
}

export function canDeleteArea(area: Area, moments: Moment[]): boolean {
  return !hasAreaMoments(area, moments);
}

/**
 * Type guard to check if result is an error
 */
export function isAreaError(result: AreaResult): result is { error: string } {
  return "error" in result;
}
