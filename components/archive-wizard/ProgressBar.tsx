type ProgressBarProps = {
  currentStep: 1 | 2 | 3
  completed?: boolean
}

export function ProgressBar({ currentStep, completed = false }: ProgressBarProps) {
  const steps = [1, 2, 3] as const

  const getStepClasses = (step: 1 | 2 | 3) => {
    if (completed || step < currentStep) {
      return 'border-emerald-300/70 bg-emerald-500/35 text-white'
    }
    if (step === currentStep) {
      return 'border-blue-300/80 bg-blue-500/40 text-white'
    }
    return 'border-white/20 bg-white/5 text-blue-100/70'
  }

  const getConnectorClasses = (step: 1 | 2 | 3) => {
    if (completed || step < currentStep) {
      return 'bg-emerald-400/70'
    }
    return 'bg-white/15'
  }

  return (
    <div className="w-full rounded-2xl border border-white/15 bg-[#081331]/88 p-4 backdrop-blur">
      <div className="flex items-center">
        {steps.map((step) => (
          <div key={step} className="flex flex-1 items-center">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${getStepClasses(
                step,
              )}`}
            >
              {completed || step < currentStep ? '✓' : step}
            </div>
            {step < 3 && <div className={`mx-3 h-1 flex-1 rounded-full ${getConnectorClasses(step)}`} />}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-blue-100/70">
        {completed ? 'Setup complete' : `Step ${currentStep} of 3`}
      </p>
    </div>
  )
}
