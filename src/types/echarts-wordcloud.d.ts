import 'echarts/types/dist/echarts'

declare module 'echarts/types/dist/echarts' {
  interface WordCloudSeriesOption {
    /** echarts-wordcloud@2.1.0 preserves the mask image ratio when enabled. */
    keepAspect?: boolean
    /** Shrinks oversized words so they remain inside the cloud mask. */
    shrinkToFit?: boolean
  }
}
