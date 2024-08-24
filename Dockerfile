FROM node:lts
RUN apt-get update && apt-get install -y git make gcc g++ curl ffmpeg
RUN git clone https://github.com/ggerganov/whisper.cpp.git
WORKDIR /whisper.cpp
RUN make tiny
RUN ln -s /whisper.cpp/main /usr/bin/whisper.cpp
RUN which whisper.cpp || echo "whisper.cpp not found"
COPY in.wav .
RUN whisper.cpp --model /whisper.cpp/models/ggml-tiny.bin -f in.wav -osrt --max-len 1 --split-on-word true -l vi
RUN cat in.wav.srt | grep Orchestration
