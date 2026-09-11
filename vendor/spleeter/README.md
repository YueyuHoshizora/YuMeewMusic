# Spleeter 2-stems

Original model: https://github.com/deezer/spleeter (MIT, Deezer SA).
ONNX conversion: https://github.com/k2-fsa/sherpa-onnx/tree/master/scripts/spleeter (Apache-2.0, Xiaomi Corporation).
Weights are downloaded at runtime from https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems at revision 7001ba316a615cacddb3f9ef3ec416661a277e26. Each model is approximately 37.5 MiB.

The JavaScript DSP uses the exported model contract: stereo magnitudes [2, 1, 512, 1024], periodic Hann 4096, hop 1024, 44100 Hz, and normalized squared-magnitude masks. Frequencies above the trained 1024 bins remain in the residual accompaniment. No model binaries or user audio are bundled.
