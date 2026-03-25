import { EyeIcon, EyeOffIcon } from 'lucide-react'
import React from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

export function InputPassword({ ...props }: React.ComponentProps<'input'>) {
  const [isPassword, setIsPassword] = React.useState(true)
  return (
    <InputGroup>
      <InputGroupInput {...props} type={isPassword ? 'password' : 'text'} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          onClick={() => setIsPassword(!isPassword)}
          aria-label="Toggle password visibility"
          title={isPassword ? 'Show password' : 'Hide password'}
          size={'icon-xs'}
        >
          {isPassword ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
