import appIcon from '../../../../assets/icon.svg'

export function Welcome() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
      <div className="chat-enter grid justify-items-center gap-3 text-center">
        <img src={appIcon} alt="" width={52} height={52} className="mb-1 size-[52px] shrink-0" />
        <h1
          id="chat-title"
          className="text-[clamp(1.75rem,3vw,2.25rem)] leading-tight font-semibold tracking-tight"
        >
          下一站，想去哪里？
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          查交通、找住宿，或规划一段行程。
        </p>
      </div>
    </div>
  )
}
