package dev.lakutata.mobile

import android.content.Context
import android.content.res.AssetManager
import android.os.Build
import android.system.Os
import java.io.File

/**
 * The Node.js project of the application. The assets have no path: the project is copied from them (assets/nodejs)
 * into the files of the application at the first launch and after each update, and its directory is given to the
 * native module (LAKUTATA_NODE_PROJECT), with a temporary directory that can be written (TMPDIR). A copy written while
 * developing (npm run deploy:android, marked by files/nodejs.dev) is kept until the application is installed again
 * (npm run android)
 */
object NodeProject {
  fun prepare(context: Context) {
    val project = File(context.filesDir, "nodejs")
    val stampFile = File(context.filesDir, "nodejs.stamp")
    val development = File(context.filesDir, "nodejs.dev")
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    @Suppress("DEPRECATION")
    val version = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    val stamp = "$version:${info.lastUpdateTime}"
    if (!development.isFile && (!project.isDirectory || !stampFile.isFile || stampFile.readText() != stamp)) {
      project.deleteRecursively()
      copy(context.assets, "nodejs", project)
      stampFile.writeText(stamp)
    }
    Os.setenv("LAKUTATA_NODE_PROJECT", project.absolutePath, true)
    Os.setenv("TMPDIR", context.cacheDir.absolutePath, true)
  }

  /**
   * Copy a file or a directory of the assets (a directory lists its entries, a file none)
   */
  private fun copy(assets: AssetManager, path: String, target: File) {
    val entries = assets.list(path) ?: emptyArray()
    if (entries.isEmpty()) {
      target.parentFile?.mkdirs()
      assets.open(path).use { input -> target.outputStream().use { output -> input.copyTo(output) } }
      return
    }
    target.mkdirs()
    for (entry in entries) copy(assets, "$path/$entry", File(target, entry))
  }
}
