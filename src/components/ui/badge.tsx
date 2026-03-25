import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils/index'

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        secondary:
          'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        destructive:
          'bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20',
        outline:
          'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        ghost:
          'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
        subtleGray:
          'bg-gray-100 text-gray-700 dark:bg-zinc-800/70 dark:text-zinc-200',
        subtleBlue:
          'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
        subtleEmerald:
          'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
        subtleRed:
          'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
        scopeGlobal:
          'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
        scopeOrganization:
          'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
        scopeTeam:
          'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
      },
      presentation: {
        default: '',
        plain: 'h-auto rounded-none border-0 bg-transparent p-0 font-normal',
        header:
          'h-auto rounded-none border-0 bg-transparent p-0 pt-0.75 font-normal',
        pill: 'rounded-full px-2 py-0.5 text-xs font-medium',
      },
    },
    defaultVariants: {
      variant: 'default',
      presentation: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  presentation = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant, presentation }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
      presentation,
    },
  })
}

export { Badge, badgeVariants }
