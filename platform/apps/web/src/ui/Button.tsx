import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

type Variant = 'primary' | 'sun' | 'paper'
type Size = 'md' | 'lg'

interface CommonProps {
  variant?: Variant
  size?: Size
  children: ReactNode
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined }
type LinkProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

const classes = (variant: Variant, size: Size, extra?: string) =>
  [styles.button, styles[variant], styles[size], extra].filter(Boolean).join(' ')

/** Un gros bouton d'autocollant qui s'enfonce quand on appuie. Un lien quand il a un `href`. */
export function Button(props: ButtonProps | LinkProps) {
  const {
    variant = 'primary',
    size = 'md',
    className,
    children,
    ...rest
  } = props as CommonProps & Record<string, unknown> & { className?: string }

  if ('href' in props && props.href !== undefined) {
    return (
      <a
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        href={props.href}
        className={classes(variant, size, className)}
      >
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      className={classes(variant, size, className)}
    >
      {children}
    </button>
  )
}
