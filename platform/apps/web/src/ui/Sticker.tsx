import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import styles from './Sticker.module.css'

type Tone = 'card' | 'sun' | 'tomato' | 'leaf'

interface StickerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
  tone?: Tone
  /** Une légère inclinaison en degrés, comme un autocollant posé à la main. */
  tilt?: number
  children: ReactNode
}

/** Le bloc de base de l'interface : contour d'encre, ombre pleine décalée. */
export function Sticker({
  as: Tag = 'div',
  tone = 'card',
  tilt = 0,
  className,
  style,
  children,
  ...rest
}: StickerProps) {
  return (
    <Tag
      {...rest}
      className={[styles.sticker, styles[tone], className].filter(Boolean).join(' ')}
      style={{ ...style, ...(tilt !== 0 && { transform: `rotate(${tilt}deg)` }) }}
    >
      {children}
    </Tag>
  )
}
