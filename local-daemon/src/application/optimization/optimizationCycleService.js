export function createOptimizationCycleService(context) {
  const {
    getCurrentAiModel,
    loadLatestAiModel,
    prepareTrainingData = async () => {},
    runOptimizationEpoch
  } = context;
  let isRunning = false;

  async function runOptimizationCycle() {
    if (isRunning) return { status: 'ALREADY_RUNNING' };
    isRunning = true;
    try {
      const dataReady = await prepareTrainingData();
      if (dataReady === false) return { status: 'DATA_NOT_READY' };
      const result = await runOptimizationEpoch({
        previousModel: getCurrentAiModel()
      });
      if (!result) return { status: 'FAILED' };
      if (result.skipped) return { status: 'UNCHANGED' };
      const reloaded = await loadLatestAiModel();
      if (reloaded === false) return { status: 'RELOAD_FAILED' };
      return { status: 'UPDATED' };
    } catch (error) {
      console.error('[OPTIMIZATION CYCLE]', error.message);
      return { status: 'FAILED' };
    } finally {
      isRunning = false;
    }
  }

  return { runOptimizationCycle };
}
