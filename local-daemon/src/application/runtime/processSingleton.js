import fs from 'node:fs';

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function acquireProcessSingleton(
  lockPath,
  {
    pid = process.pid,
    isProcessAlive = processExists
  } = {}
) {
  const tryAcquire = () => {
    const descriptor = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(descriptor, String(pid), 'utf8');
    return descriptor;
  };

  let descriptor;
  try {
    descriptor = tryAcquire();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const ownerPid = Number.parseInt(
      fs.readFileSync(lockPath, 'utf8'),
      10
    );
    if (isProcessAlive(ownerPid)) {
      throw new Error(
        `Scalp bot đã chạy với PID ${ownerPid}; từ chối process thứ hai`,
        { cause: error }
      );
    }
    fs.unlinkSync(lockPath);
    descriptor = tryAcquire();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.closeSync(descriptor);
    try {
      const ownerPid = Number.parseInt(
        fs.readFileSync(lockPath, 'utf8'),
        10
      );
      if (ownerPid === pid) fs.unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
}
