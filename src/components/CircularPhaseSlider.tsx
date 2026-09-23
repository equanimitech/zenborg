/** biome-ignore-all lint/a11y/noSvgWithoutTitle: the svg is the control's rendering, not a separate image; the wrapper carries the label */
/** biome-ignore-all lint/a11y/noStaticElementInteractions: pointer handlers implement dragging; keyboard access lives on the wrapping control */
/** biome-ignore-all lint/suspicious/noArrayIndexKey: a fixed-length ordered list of phase bands, so the index is the identity */
"use client";

import { useCallback, useRef, useState } from "react";
import type { PhaseConfig } from "@/domain/value-objects/Phase";
import { Phase } from "@/domain/value-objects/Phase";
import { PHASE_STYLES } from "@/domain/value-objects/phaseStyles";

// Design tokens - Stone-based monochrome palette (Tailwind CSS hex values)
const COLORS = {
  // Phase segment colors (stone palette for monochrome design with better contrast)
  phase: {
    morning: "#f5f5f4", // stone-100 - lightest
    afternoon: "#e7e5e4", // stone-200 - light
    evening: "#d6d3d1", // stone-300 - medium
    night: "#78716c", // stone-500 - dark
  },
  // Monochrome UI elements (stone palette)
  ui: {
    border: "#57534e", // stone-600 - subtle borders
    borderLight: "#78716c", // stone-500 - lighter borders
    innerGlow: "#0c0a09", // stone-950 - dark glow
    background: "#fafaf9", // stone-50 - light background
  },
  // Pointers
  pointer: {
    fill: "#fafaf9", // stone-50 - light pointer
    fillHover: "#f5f5f4", // stone-100
    stroke: "#57534e", // stone-600
    innerDot: "#78716c", // stone-500
    ring: "#a8a29e", // stone-400 - hover ring
  },
  // NOW indicator. The one attention signal on the dial, so it takes the
  // brand accent; slate was the only cool hue left on a warm-axis system.
  now: {
    ring: "#b07a3a", // clay-500 - the accent
    dot: "#1c1917", // stone-900
    dotStroke: "#d6d3d1", // stone-300
  },
  // Text
  text: {
    light: "#57534e", // stone-600
    dark: "#d6d3d1", // stone-300
  },
} as const;

interface CircularPhaseSliderProps {
  phaseConfigs: PhaseConfig[];
  onUpdatePhase: (phaseId: string, updates: Partial<PhaseConfig>) => void;
}

/**
 * CircularPhaseSlider - Custom SVG-based 24-hour circular slider
 *
 * Features:
 * - 4 draggable pointers for phase boundaries
 * - Colored arc segments between pointers
 * - NOW indicator showing current time
 * - Hour markers at quarter points
 */
export function CircularPhaseSlider({
  phaseConfigs,
  onUpdatePhase,
}: CircularPhaseSliderProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingPointer, setDraggingPointer] = useState<number | null>(null);

  // Constants
  const SIZE = 480; // Increased from 400 to accommodate labels
  const CENTER = SIZE / 2;
  const OUTER_RADIUS = 160;
  const INNER_RADIUS = 115; // Slightly thinner donut (45px vs 50px)

  // Find specific phases
  const morningPhase = phaseConfigs.find((p) => p.phase === "MORNING");
  const afternoonPhase = phaseConfigs.find((p) => p.phase === "AFTERNOON");
  const eveningPhase = phaseConfigs.find((p) => p.phase === "EVENING");
  const nightPhase = phaseConfigs.find((p) => p.phase === "NIGHT");

  // Get pointer positions (in hours)
  const pointerHours = [
    nightPhase?.startHour ?? 22, // Bedtime (start of Night)
    morningPhase?.startHour ?? 6, // Wake-up (start of Morning)
    afternoonPhase?.startHour ?? 12, // Start of Afternoon
    eveningPhase?.startHour ?? 18, // Start of Evening
  ];

  // Get phase colors from design tokens
  const phaseColors = [
    COLORS.phase.night,
    COLORS.phase.morning,
    COLORS.phase.afternoon,
    COLORS.phase.evening,
  ];

  // Convert hour (0-23) to angle in degrees (0° = top/12AM)
  const hourToAngle = (hour: number): number => {
    return (hour / 24) * 360 - 90; // -90 to start at top
  };

  // Convert angle to hour
  const angleToHour = (angle: number): number => {
    const normalized = (angle + 90 + 360) % 360;
    return Math.round((normalized / 360) * 24) % 24;
  };

  // Get SVG coordinates for a point on the circle
  const polarToCartesian = (
    angle: number,
    radius: number,
  ): { x: number; y: number } => {
    const radians = (angle * Math.PI) / 180;
    return {
      x: CENTER + radius * Math.cos(radians),
      y: CENTER + radius * Math.sin(radians),
    };
  };

  // Create SVG donut arc path (filled segment between inner and outer radius)
  const describeDonutArc = (
    startAngle: number,
    endAngle: number,
    outerRadius: number,
    innerRadius: number,
  ): string => {
    const start = startAngle;
    let end = endAngle;

    // Handle wrap-around
    if (end < start) {
      end += 360;
    }

    const outerStart = polarToCartesian(start, outerRadius);
    const outerEnd = polarToCartesian(end, outerRadius);
    const innerStart = polarToCartesian(start, innerRadius);
    const innerEnd = polarToCartesian(end, innerRadius);

    const largeArcFlag = end - start <= 180 ? "0" : "1";

    return [
      "M",
      outerStart.x,
      outerStart.y,
      "A",
      outerRadius,
      outerRadius,
      0,
      largeArcFlag,
      1,
      outerEnd.x,
      outerEnd.y,
      "L",
      innerEnd.x,
      innerEnd.y,
      "A",
      innerRadius,
      innerRadius,
      0,
      largeArcFlag,
      0,
      innerStart.x,
      innerStart.y,
      "Z",
    ].join(" ");
  };

  // Validate that hour is strictly increasing from previous phase
  const isValidHour = (pointerIndex: number, newHour: number): boolean => {
    const currentHours = [...pointerHours];
    currentHours[pointerIndex] = newHour;

    // Check strict ordering: Night(0) < Morning(1) < Afternoon(2) < Evening(3) < Night(0)+24
    // Night wraps around, so we need special handling
    const [night, morning, afternoon, evening] = currentHours;

    // Morning must be after night (considering night might be 22-23 and morning 0-11)
    // Night is typically in evening hours (18-23), morning in early hours (0-11)
    if (morning <= night && night >= 12) {
      // Night is in PM, morning is in AM - this is valid
    } else if (morning <= night && night < 12) {
      // Both in AM or both in PM with morning before night - invalid
      return false;
    }

    // Afternoon must be strictly after morning
    if (afternoon <= morning) {
      return false;
    }

    // Evening must be strictly after afternoon
    if (evening <= afternoon) {
      return false;
    }

    // Night must be strictly after evening (both should be in PM hours typically)
    if (night <= evening && evening < 18) {
      return false;
    }

    return true;
  };

  // Handle pointer drag
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds form state when the dialog opens; re-running on every dep change would discard edits
  const handlePointerMove = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (draggingPointer === null || !svgRef.current) return;

      const svg = svgRef.current;
      const rect = svg.getBoundingClientRect();

      const clientX =
        "touches" in event ? event.touches[0].clientX : event.clientX;
      const clientY =
        "touches" in event ? event.touches[0].clientY : event.clientY;

      const x = clientX - rect.left - CENTER;
      const y = clientY - rect.top - CENTER;

      const angle = (Math.atan2(y, x) * 180) / Math.PI;
      const hour = angleToHour(angle);

      // Validate strictly increasing constraint
      if (!isValidHour(draggingPointer, hour)) {
        return; // Reject invalid hour
      }

      // Update the appropriate phase based on which pointer is being dragged
      const phaseMap = [nightPhase, morningPhase, afternoonPhase, eveningPhase];
      const phase = phaseMap[draggingPointer];

      if (!phase) return;

      // Update phase start hour
      onUpdatePhase(phase.id, { startHour: hour });

      // Update adjacent phase end hours
      if (draggingPointer === 0 && eveningPhase) {
        // Night pointer updates Evening's end
        onUpdatePhase(eveningPhase.id, { endHour: hour });
      } else if (draggingPointer === 1 && nightPhase) {
        // Morning pointer updates Night's end
        onUpdatePhase(nightPhase.id, { endHour: hour });
      } else if (draggingPointer === 2 && morningPhase) {
        // Afternoon pointer updates Morning's end
        onUpdatePhase(morningPhase.id, { endHour: hour });
      } else if (draggingPointer === 3 && afternoonPhase) {
        // Evening pointer updates Afternoon's end
        onUpdatePhase(afternoonPhase.id, { endHour: hour });
      }
    },
    [
      CENTER,
      draggingPointer,
      nightPhase,
      morningPhase,
      afternoonPhase,
      eveningPhase,
      onUpdatePhase,
      pointerHours,
    ],
  );

  const handlePointerUp = useCallback(() => {
    setDraggingPointer(null);
  }, []);

  // Attach/detach event listeners
  const handlePointerDown = (index: number) => {
    setDraggingPointer(index);
  };

  // Format hour for display
  const formatHour = (hour: number): string => {
    if (hour === 0) return "12 AM";
    if (hour === 12) return "12 PM";
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  // Current time
  const currentHour = new Date().getHours();
  const currentAngle = hourToAngle(currentHour);
  const nowPos = polarToCartesian(currentAngle, OUTER_RADIUS);

  // Phase data with icons from PHASE_STYLES
  const phases = [
    {
      name: "Night",
      Icon: PHASE_STYLES[Phase.NIGHT].icon,
    },
    {
      name: "Morning",
      Icon: PHASE_STYLES[Phase.MORNING].icon,
    },
    {
      name: "Afternoon",
      Icon: PHASE_STYLES[Phase.AFTERNOON].icon,
    },
    {
      name: "Evening",
      Icon: PHASE_STYLES[Phase.EVENING].icon,
    },
  ];

  return (
    <div className="relative w-full max-w-md mx-auto select-none">
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto select-none max-w-[280px] md:max-w-full"
        onMouseMove={(e) => handlePointerMove(e.nativeEvent)}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchMove={(e) => handlePointerMove(e.nativeEvent)}
        onTouchEnd={handlePointerUp}
      >
        {/* Subtle drop shadow definition */}
        <defs>
          <filter
            id="pointer-shadow"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
            <feOffset dx="0" dy="1" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.3" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="inner-glow" cx="50%" cy="50%" r="50%">
            <stop
              offset="85%"
              stopColor={COLORS.ui.innerGlow}
              stopOpacity="0"
            />
            <stop
              offset="100%"
              stopColor={COLORS.ui.innerGlow}
              stopOpacity="0.2"
            />
          </radialGradient>
        </defs>

        {/* Phase donut segments - MUST be drawn first (bottom layer) */}
        {pointerHours.map((_, index) => {
          const startHour = pointerHours[index];
          const endHour = pointerHours[(index + 1) % 4];
          const color = phaseColors[index];

          const startAngle = hourToAngle(startHour);
          let endAngle = hourToAngle(endHour);

          // Handle midnight wrap
          if (endAngle < startAngle) {
            endAngle += 360;
          }

          return (
            <path
              key={`segment-${index}`}
              d={describeDonutArc(
                startAngle,
                endAngle,
                OUTER_RADIUS,
                INNER_RADIUS,
              )}
              fill={color}
              stroke={COLORS.ui.border}
              strokeWidth={0.5}
              pointerEvents="none"
            />
          );
        })}

        {/* Inner circle with subtle glow effect - drawn on top to create hole */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={INNER_RADIUS}
          fill="url(#inner-glow)"
          stroke={COLORS.ui.border}
          strokeWidth={1}
        />

        {/* Outer boundary - very subtle */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={OUTER_RADIUS}
          fill="none"
          stroke={COLORS.ui.border}
          strokeWidth={0.5}
        />

        {/* Phase icons in the middle of each arc */}
        {pointerHours.map((_, index) => {
          const startHour = pointerHours[index];
          const endHour = pointerHours[(index + 1) % 4];

          const startAngle = hourToAngle(startHour);
          let endAngle = hourToAngle(endHour);

          // Handle midnight wrap
          if (endAngle < startAngle) {
            endAngle += 360;
          }

          // Middle of the arc
          const midAngle = startAngle + (endAngle - startAngle) / 2;
          const midRadius = (OUTER_RADIUS + INNER_RADIUS) / 2;
          const iconPos = polarToCartesian(midAngle, midRadius);
          const IconComponent = phases[index].Icon;

          // Use darker color for better contrast (night phase gets lighter color)
          const iconColor = index === 0 ? "#e7e5e4" : "#44403c"; // night: stone-200, others: stone-700

          return (
            <foreignObject
              key={`icon-${index}`}
              x={iconPos.x - 16}
              y={iconPos.y - 16}
              width={32}
              height={32}
              pointerEvents="none"
            >
              <div
                className="flex items-center justify-center w-full h-full"
                style={{ color: iconColor }}
              >
                <IconComponent className="w-6 h-6" />
              </div>
            </foreignObject>
          );
        })}

        {/* NOW indicator - subtle monochromatic dot with accent ring */}
        <g pointerEvents="none">
          <circle
            cx={nowPos.x}
            cy={nowPos.y}
            r={8}
            fill="none"
            stroke={COLORS.now.ring}
            strokeWidth={1.5}
            opacity={0.4}
          />
          <circle
            cx={nowPos.x}
            cy={nowPos.y}
            r={4}
            fill={COLORS.now.dot}
            stroke={COLORS.now.dotStroke}
            strokeWidth={1.5}
          />
        </g>

        {/* Pointers on the outer edge with hour labels */}
        {pointerHours.map((hour, index) => {
          const angle = hourToAngle(hour);
          const pos = polarToCartesian(angle, OUTER_RADIUS);
          const labelPos = polarToCartesian(angle, OUTER_RADIUS + 40);
          const isDragging = draggingPointer === index;

          return (
            <g
              key={`pointer-${hour}-${index}`}
              onMouseDown={() => handlePointerDown(index)}
              onTouchStart={() => handlePointerDown(index)}
              className="cursor-grab active:cursor-grabbing"
            >
              {/* Outer ring - shows on hover/drag */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={18}
                fill="none"
                stroke={COLORS.pointer.ring}
                strokeWidth={1}
                opacity={isDragging ? 0.6 : 0}
                className="transition-opacity hover:opacity-40"
              />

              {/* Main pointer with shadow */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={12}
                fill={COLORS.pointer.fill}
                stroke={COLORS.pointer.stroke}
                strokeWidth={2}
                filter="url(#pointer-shadow)"
                style={{
                  transition: "fill 150ms",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.setAttribute(
                    "fill",
                    COLORS.pointer.fillHover,
                  );
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.setAttribute("fill", COLORS.pointer.fill);
                }}
              />

              {/* Inner dot for visual interest */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={4}
                fill={COLORS.pointer.innerDot}
                pointerEvents="none"
              />

              {/* Hour label with background */}
              <g pointerEvents="none">
                {/* Label background for better visibility */}
                <rect
                  x={labelPos.x - 24}
                  y={labelPos.y - 10}
                  width={48}
                  height={20}
                  rx={4}
                  fill={COLORS.ui.background}
                  stroke={COLORS.ui.borderLight}
                  strokeWidth={0.5}
                  opacity={0.95}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-sm font-mono font-medium"
                  fill={COLORS.text.light}
                >
                  {formatHour(hour)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
