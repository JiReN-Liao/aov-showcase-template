export default function BlurText({ text, as: Element = 'p', className = '', delay = 55 }) {
  return (
    <Element className={`blur-text ${className}`} aria-label={text}>
      <span aria-hidden="true">
        {Array.from(text).map((character, index) => (
          <span key={`${character}-${index}`} className="blur-text-segment" style={{ '--blur-delay': `${index * delay}ms` }}>
            {character === ' ' ? '\u00a0' : character}
          </span>
        ))}
      </span>
    </Element>
  )
}
