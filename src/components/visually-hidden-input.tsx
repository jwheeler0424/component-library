"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { cn } from "@/lib/utils";

type InputValue = Array<string> | string;

export interface VisuallyHiddenInputProps<T = InputValue> extends Omit<
  useRender.ComponentProps<"input">,
  "value" | "checked" | "onReset"
> {
  /**
   * The value of the input element.
   */
  value?: T;
  /**
   * Whether the input is checked (for checkbox/radio types).
   */
  checked?: boolean;
  /**
   * Whether the input is in an indeterminate state.
   */
  indeterminate?: boolean;
  /**
   * The element whose dimensions this hidden input should mimic for proper
   * browser 'scroll-to-invalid' and pointer event alignment.
   */
  control: HTMLElement | null;
  /**
   * Whether input events should bubble up the DOM.
   */
  bubbles?: boolean;
  /**
   * React 19 ref prop.
   */
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * A visually hidden input component built on Base UI primitives.
 * Designed for use within custom form controls (switches, checkboxes)
 * to maintain accessibility and native form participation.
 */
export function VisuallyHiddenInput<T = InputValue>(
  props: VisuallyHiddenInputProps<T>,
) {
  const {
    control,
    value,
    checked,
    bubbles = true,
    type = "hidden",
    className,
    style,
    render,
    ref,
    ...restProps
  } = props;

  const inputRef = React.useRef<HTMLInputElement>(null);

  const isCheckInput = React.useMemo(
    () => type === "checkbox" || type === "radio" || type === "switch",
    [type],
  );

  // Track values for manual event dispatching
  const prevValueRef = React.useRef<T | boolean | undefined>(
    isCheckInput ? checked : value,
  );

  const [controlSize, setControlSize] = React.useState<{
    width?: number;
    height?: number;
  }>({});

  // Synchronize dimensions with the 'control' element
  React.useLayoutEffect(() => {
    if (!control) {
      setControlSize({});
      return;
    }

    const updateSize = () => {
      setControlSize({
        width: control.offsetWidth,
        height: control.offsetHeight,
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      if (entry.borderBoxSize?.[0]) {
        setControlSize({
          width: entry.borderBoxSize[0].inlineSize,
          height: entry.borderBoxSize[0].blockSize,
        });
      } else {
        updateSize();
      }
    });

    resizeObserver.observe(control, { box: "border-box" });
    return () => resizeObserver.disconnect();
  }, [control]);

  // Programmatic event dispatching to ensure form libraries (React Hook Form, etc.)
  // catch changes made via props
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const currentValue = isCheckInput ? checked : value;
    if (prevValueRef.current === currentValue) return;

    const inputProto = window.HTMLInputElement.prototype;
    const propertyKey = isCheckInput ? "checked" : "value";
    const eventType = isCheckInput ? "click" : "input";

    const descriptor = Object.getOwnPropertyDescriptor(inputProto, propertyKey);
    const setter = descriptor?.set?.bind(input);

    if (setter) {
      const serializedValue =
        !isCheckInput && typeof value === "object"
          ? JSON.stringify(value)
          : (currentValue as string | boolean);

      setter.call(input, serializedValue);
      input.dispatchEvent(new Event(eventType, { bubbles }));
    }

    prevValueRef.current = currentValue;
  }, [value, checked, bubbles, isCheckInput]);

  const defaultProps: useRender.ElementProps<"input"> = {
    type,
    "aria-hidden": isCheckInput,
    tabIndex: -1,
    // Using standard Tailwind classes for visual hiding
    className: cn(
      "pointer-events-none absolute -m-px overflow-hidden border-0 p-0 whitespace-nowrap opacity-0",
      "[clip-path:inset(50%)] [clip:rect(0_0_0_0)]",
      className,
    ),
    style: {
      ...style,
      width: controlSize.width ?? 1,
      height: controlSize.height ?? 1,
    },
  };

  // useRender handles the ref array [external, internal] and supports the 'render' prop
  return useRender({
    defaultTagName: "input",
    ref: [ref, inputRef].filter(Boolean) as Array<
      React.Ref<HTMLInputElement> | React.RefObject<HTMLInputElement | null>
    >,
    render,
    props: mergeProps<"input">(defaultProps, restProps),
  });
}
