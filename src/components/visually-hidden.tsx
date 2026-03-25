'use client'
import type * as React from 'react'

import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'

export interface VisuallyHiddenProps extends useRender.ComponentProps<React.ElementType> {
  /**
   * React 19 ref prop.
   */
  ref?: React.Ref<HTMLInputElement>
}

/**
 * A visually hidden input component built on Base UI primitives.
 * Designed for use within custom form controls (switches, checkboxes)
 * to maintain accessibility and native form participation.
 */
export function VisuallyHidden(props: VisuallyHiddenProps) {
  const { style, render, ref, ...visuallyHiddenProps } = props

  const defaultProps: useRender.ElementProps<React.ElementType> = {
    ...visuallyHiddenProps,
    style: {
      border: 0,
      clip: 'rect(0 0 0 0)',
      clipPath: 'inset(50%)',
      height: '1px',
      margin: '-1px',
      overflow: 'hidden',
      padding: 0,
      position: 'absolute',
      whiteSpace: 'nowrap',
      width: '1px',
      ...style,
    },
  }

  // useRender handles the ref array [external, internal] and supports the 'render' prop
  return useRender({
    defaultTagName: 'div',
    ref,
    render,
    props: mergeProps<'div'>(defaultProps, visuallyHiddenProps),
  })
}
