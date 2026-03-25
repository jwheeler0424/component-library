import React from 'react'

import { useIsomorphicLayoutEffect } from './use-isomorphic-effect'

function useAsRef<T>(data: T) {
  const ref = React.useRef<T>(data)
  useIsomorphicLayoutEffect(() => {
    ref.current = data
  })
  return ref
}

export { useAsRef }
