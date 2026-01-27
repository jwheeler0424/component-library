import { Debouncer } from '@tanstack/pacer'
import * as React from 'react'
import type { DebouncerOptions } from '@tanstack/pacer'
import { Textarea } from '@/components/ui/textarea'

type Mode = 'leading' | 'trailing' | 'both'

export type TextareaDebouncedHandle = {
  flush: () => void
  cancel: () => void
  reset: () => void
  setOptions: (
    options: Partial<DebouncerOptions<(next: string) => void>>,
  ) => void
  getDebouncedValue: () => string
  getPendingValue: () => string
}

export type TextareaDebouncedProps =
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    value?:
      | string
      | number
      | (ReadonlyArray<string> & string)
      | (ReadonlyArray<string> & number)
      | undefined
    defaultValue?:
      | string
      | number
      | (ReadonlyArray<string> & string)
      | (ReadonlyArray<string> & number)
      | undefined
    waitMs?: number
    mode?: Mode
    leading?: boolean
    trailing?: boolean
    onDebouncedChange?: (value: string) => void
    emitOnMount?: boolean
    flushOnBlur?: boolean
    cancelOnEscape?: boolean
    cancelOnUnmount?: boolean
    onDebounceStart?: () => void
    onDebounceEnd?: () => void
    describedById?: string
    /**
     * Generate the live status message. Return null/"" to suppress.
     */
    getStatusMessage?: (state: {
      isDebouncing: boolean
      error?: string
      value: string
      debouncedValue: string
    }) => string | null | undefined
    devKey?: string
  }

const TextareaDebounced = React.forwardRef<
  HTMLTextAreaElement | TextareaDebouncedHandle,
  TextareaDebouncedProps
>(
  (
    {
      value: controlledValue,
      defaultValue,
      mode,
      onChange,
      leading = false,
      trailing = true,
      emitOnMount = false,
      flushOnBlur = false,
      onDebouncedChange,
      onDebounceStart,
      onDebounceEnd,
      waitMs = 200,
      cancelOnEscape = false,
      cancelOnUnmount = true,
      describedById,
      getStatusMessage,
      devKey = 'TextareaDebounced',
      ...rest
    }: TextareaDebouncedProps,
    forwardedRef,
  ) => {
    const isControlled = controlledValue !== undefined
    const [uncontrolledValue, setUncontrolledValue] =
      React.useState(defaultValue)
    const [debouncedValue, setDebouncedValue] = React.useState(
      controlledValue ?? defaultValue,
    )
    const [isDebouncing, setIsDebouncing] = React.useState(false)

    const textareaValue = isControlled ? controlledValue : uncontrolledValue

    // Map mode -> leading/trailing
    const { resolvedLeading, resolvedTrailing } = React.useMemo(() => {
      if (mode === 'leading')
        return { resolvedLeading: true, resolvedTrailing: false }
      if (mode === 'both')
        return { resolvedLeading: true, resolvedTrailing: true }
      return { resolvedLeading: leading, resolvedTrailing: trailing }
    }, [mode, leading, trailing])

    const debouncer = React.useMemo(() => {
      const fn = (next: string) => {
        setDebouncedValue(next)
        setIsDebouncing(false)
        onDebounceEnd?.()
      }

      return new Debouncer(fn, {
        key: devKey,
        wait: waitMs,
        leading: resolvedLeading,
        trailing: resolvedTrailing,
      })
    }, [waitMs, resolvedLeading, resolvedTrailing, onDebounceEnd])

    // Push latest textarea value through the debouncer.
    React.useEffect(() => {
      setIsDebouncing(true)
      onDebounceStart?.()
      debouncer.maybeExecute(String(textareaValue))
      return () => {
        if (cancelOnUnmount) debouncer.cancel()
      }
    }, [textareaValue, debouncer, cancelOnUnmount, onDebounceStart])

    // Fire consumer callback when the debounced value updates.
    const didMountRef = React.useRef(false)
    React.useEffect(() => {
      if (!onDebouncedChange) return
      if (!emitOnMount && !didMountRef.current) {
        didMountRef.current = true
        return
      }
      onDebouncedChange(String(debouncedValue))
    }, [debouncedValue, onDebouncedChange, emitOnMount])

    // Expose controls via ref
    React.useImperativeHandle(
      forwardedRef as React.Ref<TextareaDebouncedHandle>,
      () => ({
        flush: () => debouncer.flush(),
        cancel: () => debouncer.cancel(),
        reset: () => debouncer.reset(),
        setOptions: (options) => debouncer.setOptions(options),
        getDebouncedValue: () => String(debouncedValue),
        getPendingValue: () => String(textareaValue),
      }),
      [debouncer, debouncedValue, textareaValue],
    )

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value
      if (!isControlled) setUncontrolledValue(next)

      onChange?.(event)
    }

    const handleBlur = (event: React.FocusEvent<HTMLTextAreaElement>) => {
      if (flushOnBlur) debouncer.flush()
      rest.onBlur?.(event)
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (cancelOnEscape && event.key === 'Escape') {
        debouncer.cancel()
        if (!isControlled) {
          setUncontrolledValue(debouncedValue) // revert uncontrolled to last debounced
        }
      }
      rest.onKeyDown?.(event)
    }

    const ariaInvalid =
      rest['aria-invalid'] === true ||
      rest['aria-invalid'] === 'true' ||
      undefined

    const ariaDescribedBy =
      [rest['aria-describedby'], describedById].filter(Boolean).join(' ') ||
      undefined

    return (
      <Textarea
        ref={forwardedRef as React.Ref<HTMLTextAreaElement>}
        value={textareaValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        data-state={isDebouncing ? 'debouncing' : 'settled'}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        {...rest}
      />
    )
  },
)

TextareaDebounced.displayName = 'TextareaDebounced'

export { TextareaDebounced }
