import { execFile } from 'node:child_process'
import path from 'node:path'
import { freshLocation, LocationError, locationResponseSchema } from '../location'

// Fixed, input-free WinRT bridge. Windows PowerShell ships with Windows; no downloads or shell interpolation.
const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime] | Out-Null
  [Windows.Devices.Geolocation.Geoposition,Windows.Devices.Geolocation,ContentType=WindowsRuntime] | Out-Null
  [Windows.Devices.Geolocation.GeolocationAccessStatus,Windows.Devices.Geolocation,ContentType=WindowsRuntime] | Out-Null
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\u00601' } | Select-Object -First 1
  function Wait-Operation($operation, $resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (-not $task.Wait(15000)) { throw [TimeoutException]::new('Location timeout') }
    return $task.Result
  }
  $access = Wait-Operation ([Windows.Devices.Geolocation.Geolocator]::RequestAccessAsync()) ([Windows.Devices.Geolocation.GeolocationAccessStatus])
  if ($access.ToString() -eq 'Denied') { @{ok=$false;code='denied'} | ConvertTo-Json -Compress; exit }
  if ($access.ToString() -ne 'Allowed') { @{ok=$false;code='unavailable'} | ConvertTo-Json -Compress; exit }
  $locator = [Windows.Devices.Geolocation.Geolocator]::new()
  $locator.DesiredAccuracyInMeters = 100
  $position = Wait-Operation ($locator.GetGeopositionAsync([TimeSpan]::FromSeconds(30), [TimeSpan]::FromSeconds(12))) ([Windows.Devices.Geolocation.Geoposition])
  if ($position.Coordinate.PositionSource.ToString() -eq 'Default') { @{ok=$false;code='unavailable'} | ConvertTo-Json -Compress; exit }
  @{ok=$true;position=@{latitude=$position.Coordinate.Point.Position.Latitude;longitude=$position.Coordinate.Point.Position.Longitude;accuracy=$position.Coordinate.Accuracy;timestamp=$position.Coordinate.Timestamp.ToUnixTimeMilliseconds()}} | ConvertTo-Json -Depth 4 -Compress
} catch {
  $code = 'unavailable'
  $exception = $_.Exception
  while ($null -ne $exception) {
    if ($exception.HResult -eq -2147024891) { $code = 'denied'; break }
    if ($exception -is [TimeoutException]) { $code = 'timeout' }
    $exception = $exception.InnerException
  }
  @{ok=$false;code=$code} | ConvertTo-Json -Compress
}
`

export async function windowsPosition(signal: AbortSignal) {
  signal.throwIfAborted()
  if (process.platform !== 'win32')
    throw new LocationError('unavailable', '当前平台不支持 Windows 定位')
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 20_000, maxBuffer: 16_384, signal, encoding: 'utf8' },
      (error, stdout) => {
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        if (error) {
          reject(new LocationError('unavailable', 'Windows 定位服务未返回位置'))
          return
        }
        resolve(stdout.trim().replace(/^\uFEFF/, ''))
      },
    )
  })
  let result
  try {
    result = locationResponseSchema.parse(JSON.parse(output))
  } catch {
    throw new LocationError('unavailable', 'Windows 定位结果无效')
  }
  if (!result.ok)
    throw new LocationError(
      result.code,
      result.code === 'denied'
        ? 'Windows 定位权限已拒绝，请手动提供出发地'
        : 'Windows 定位暂不可用',
    )
  return freshLocation(result.position)
}
