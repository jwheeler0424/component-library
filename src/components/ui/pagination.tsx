import * as React from 'react'

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from 'lucide-react'
import { Link } from './link'
import type { JSX } from 'react'
import { cn } from '@/lib/utils/index'
import { Button } from '@/components/ui/button'

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex items-center gap-0.5', className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & React.ComponentProps<typeof Link>

function PaginationLink({
  className,
  isActive,
  size = 'icon',
  ...props
}: PaginationLinkProps) {
  return (
    <Link
      variant={isActive ? 'outline' : 'ghost'}
      size={size}
      className={cn(className)}
      aria-current={isActive ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      {...props}
    />
  )
}

type PaginationButtonProps = React.ComponentProps<typeof Button> & {
  isActive?: boolean
  text?: string
}

function PaginationButton({
  className,
  isActive,
  text,
  ...props
}: PaginationButtonProps) {
  return (
    <Button
      className={cn(
        props.disabled && 'bg-muted text-muted-foreground/80',
        className,
      )}
      variant={isActive ? 'secondary' : !props.disabled ? 'outline' : 'ghost'}
      aria-current={isActive ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      {...props}
    />
  )
}

type PaginationBaseProps = {
  text?: string
  className?: string
}

type PaginationDirectionLinkProps = PaginationBaseProps &
  React.ComponentProps<typeof PaginationLink> & {
    type: 'link'
  }

type PaginationDirectionButtonProps = PaginationBaseProps &
  React.ComponentProps<typeof PaginationButton> & {
    type: 'button'
  }

type PaginationPreviousProps =
  | PaginationDirectionLinkProps
  | PaginationDirectionButtonProps

function PaginationPreviousButton({
  className,
  text = 'Previous',
  ...props
}: Omit<PaginationDirectionButtonProps, 'type' | 'text'> & {
  text?: string
}) {
  return (
    <PaginationButton
      aria-label="Go to previous page"
      size="default"
      className={cn('pl-1.5!', className)}
      {...props}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      <span className="hidden sm:block">{text}</span>
    </PaginationButton>
  )
}

function PaginationPreviousLink({
  className,
  text = 'Previous',
  ...props
}: Omit<PaginationDirectionLinkProps, 'type' | 'text'> & {
  text?: string
}) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn('sm:pl-1.5!', className)}
      {...props}
    >
      <ChevronLeftIcon data-icon="inline-start" />
      <span className="hidden sm:block">{text}</span>
    </PaginationLink>
  )
}

function PaginationPrevious(props: PaginationPreviousProps): JSX.Element
function PaginationPrevious(props: PaginationPreviousProps): JSX.Element
function PaginationPrevious(props: PaginationPreviousProps) {
  const { type } = props

  if (type === 'link') {
    const { type: _type, text, ...rest } = props
    return <PaginationPreviousLink {...rest} text={text} />
  }

  const { type: _type, text, ...rest } = props
  return <PaginationPreviousButton {...rest} text={text} />
}

type PaginationNextProps =
  | PaginationDirectionLinkProps
  | PaginationDirectionButtonProps

function PaginationNextButton({
  className,
  text = 'Next',
  ...props
}: Omit<PaginationDirectionButtonProps, 'type' | 'text'> & {
  text?: string
}) {
  return (
    <PaginationButton
      aria-label="Go to next page"
      size="default"
      className={cn('sm:pr-1.5!', className)}
      {...props}
    >
      <span className="hidden sm:block">{text}</span>
      <ChevronRightIcon data-icon="inline-end" />
    </PaginationButton>
  )
}

function PaginationNextLink({
  className,
  text = 'Next',
  ...props
}: Omit<PaginationDirectionLinkProps, 'type' | 'text'> & {
  text?: string
}) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn('pr-1.5!', className)}
      {...props}
    >
      <span className="hidden sm:block">{text}</span>
      <ChevronRightIcon data-icon="inline-end" />
    </PaginationLink>
  )
}

function PaginationNext(props: PaginationNextProps): JSX.Element
function PaginationNext(props: PaginationNextProps): JSX.Element
function PaginationNext(props: PaginationNextProps) {
  const { type } = props

  if (type === 'link') {
    const { type: _type, text, ...rest } = props
    return <PaginationNextLink {...rest} text={text} />
  }

  const { type: _type, text, ...rest } = props
  return <PaginationNextButton {...rest} text={text} />
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <MoreHorizontalIcon />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
