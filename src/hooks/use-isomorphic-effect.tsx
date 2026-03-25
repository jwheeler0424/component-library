import * as React from 'react'

const useIsomorphicLayoutEffect = (
  effect: React.EffectCallback,
  deps?: React.DependencyList | null,
) =>
  typeof window !== 'undefined'
    ? React.useLayoutEffect.apply(this, [
        effect,
        deps === undefined ? [] : deps === null ? undefined : deps,
      ])
    : React.useEffect.apply(this, [
        effect,
        deps === undefined ? [] : deps === null ? undefined : deps,
      ])

export { useIsomorphicLayoutEffect }
