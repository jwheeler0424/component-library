'use client'
import { Link as RouterLink } from '@tanstack/react-router'
import React from 'react'
import type { VariantProps } from 'class-variance-authority'
import { buttonVariants } from '@/components/ui/button'

import { cn } from '@/lib/utils'

const linkVariants = buttonVariants

function Link({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof RouterLink> &
  VariantProps<typeof linkVariants>) {
  return (
    <RouterLink
      data-slot="button"
      className={cn(linkVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Link, linkVariants }
