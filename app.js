console.log('='.repeat(350));
let job = require('./audio.json');
let jobData = job.data;
let videoScript = jobData.videoScript;
let translated = videoScript.map((item) => { return item.translated; });
let audioFile = jobData.audioFile;
// console.log(audioFile);
let Queue = require('bull');
// whisper.cpp --model /whisper.cpp/models/ggml-tiny.bin -f in.wav -osrt --max-len 1 --split-on-word true -l vi
let whisperFile = async (modelFile, inputFile, outputFile, whisperExecFile) => {
    let outputFileWithoutExt = outputFile.replace(/\.[^/.]+$/, '');
    let whisper = child_process.spawn(whisperExecFile, ['--model', modelFile, '-f', inputFile, '-ojf', '--max-len', '1', '--split-on-word', 'true', '-l', 'vi', '-of', outputFileWithoutExt]);
    whisper.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });
    whisper.stderr.on('data', (data) => {
        console.log(`stderr: ${data}`);
    });
    whisper.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
    });
    await new Promise((resolve, reject) => {
        whisper.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error('whisper failed'));
            }
        });
    });
    console.log('End whispering...');

    return outputFile;
}

let child_process = require('child_process');
let fs = require('fs');
function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
}
function removePunctuation(text) {
    // replace all punctuation and newlines with empty string
    return text.replace(/[.,\/#!$%\^&\*;:{}=\-–_`~()]/g, '').replace(/\n/g, ' ').replace(/\s+/g, ' ');
}
function correctTranscription(transcription, translated) {
    let translatedText = translated.join('').toLowerCase()
    translatedText = removePunctuation(translatedText);
    console.log('Correcting transcription...');
    for (let i = 0; i < transcription.length; i++) {
        let phrase = transcription.slice(i, i + 5).map((item) => { return item.text; }).join('');
        phrase = phrase.trim().toLowerCase();
        phrase = removePunctuation(phrase).trim();
        // if the phrase is in the translated text
        if (translatedText.includes(' ' + phrase + ' ')) {
            // mark these words as corrected
            for (let j = i; j < i + 5; j++) {
                if (j >= transcription.length) {
                    break;
                }
                transcription[j].corrected = true;
            }
        }
    }
    transcription = transcription.filter((item) => { return item.text.replace(/^\s+$/gi, '').length > 0; });
    // transcription = transcription.slice(0, 80);

    delete transcription[0].tokens;
    delete transcription[0].timestamps;
    console.log('Correcting transcription pass 1', transcription[0]);
    let processed;
    processed = {
        fromBeginning: [],
        transcription2: transcription,
        translatedText2: translatedText
    }
    // return processed.transcription2;
    let max = 3;
    let i = 0;
    do {
        i++;
        if (i > max) {
            // break;
        }
        processed = processIncorrectPhrases(processed.transcription2, processed.translatedText2, processed.fromBeginning);
    } while (processed.transcription2.length > 0);
    //
    processed.fromBeginning = processed.fromBeginning.map((item) => {
        return {
            text: item.text.trim(),
            offsets: item.offsets,
            // tmpCorrected
            corrected: item.tmpCorrected ? false : true,
        };
    });
    for (let i = 0; i < processed.fromBeginning.length; i++) {
        let item = processed.fromBeginning[i];
        console.log(i, ', ', item.text, item.offsets);
    }
    // processed.fromBeginning = processed.fromBeginning.filter((item) => { return !item.beRemoved; });

    return processed.fromBeginning;
};
function processIncorrectPhrases(transcription, translatedText, fromBeginning) {
    let correctedAtFirst = transcription.findIndex((item) => { return item.corrected; });
    let postTextItems = transcription.slice(correctedAtFirst, correctedAtFirst + 5);
    let postText = postTextItems.map((item) => { return item.text.trim(); }).join(' ').toLowerCase().trim();
    postText = removePunctuation(postText);
    if (correctedAtFirst > 0) {
        let positionOfPostTextInTranslatedText = translatedText.indexOf(postText);
        if (positionOfPostTextInTranslatedText === -1) {
            console.log('Post text:', postText);
            console.log('Translated text:', translatedText);
            throw new Error('Post text not found in translated text');
        }
        let correctedText = translatedText.substring(0, positionOfPostTextInTranslatedText).trim();
        let correctedTextWordsCount = correctedText.split(' ').length;
        // console.log('Transcription pass', translatedText.indexOf(postText));
        if (correctedTextWordsCount === correctedAtFirst) {
            for (let i = 0; i < correctedAtFirst; i++) {
                transcription[i].text = " " + correctedText.split(' ')[i];
                transcription[i].corrected = true;
            }
        }else{
            // transcription[0].text = " " + correctedText;
            transcription[0].corrected = true;
            for (let i = 1; i < correctedAtFirst; i++) {
                // transcription[i].text = "";
                transcription[i].corrected = true;
                transcription[i].tmpCorrected = true;
                // transcription[i].beRemoved = true;
            }
        }
    }
    let nextIncorrectedAtFirst = transcription.findIndex((item) => { return !item.corrected; });
    if (nextIncorrectedAtFirst === -1) {
        return {
            fromBeginning: fromBeginning.concat(transcription),
            transcription2: [],
            translatedText2: translatedText
        };
    }
    // transcription[0].text = " | " + transcription[0].text.trim() + " < ";
    fromBeginning = fromBeginning.concat(transcription.slice(0, nextIncorrectedAtFirst));

    postTextItems = transcription.slice(nextIncorrectedAtFirst - 5, nextIncorrectedAtFirst);
    postText = postTextItems.map((item) => { return item.text; }).join('');
    let endOfPostText = translatedText.indexOf(postText) + postText.length;
    let cutTranslateText = translatedText.slice(endOfPostText);
    transcription = transcription.slice(nextIncorrectedAtFirst);
    // remove all items before the next incorrected phrase
    if (cutTranslateText.length === 0) {
        return transcription;
    }

    return {
        fromBeginning,
        transcription2: transcription,
        translatedText2: cutTranslateText
    };
}

let redisHost = process.env.REDIS_HOST || '';
let password = process.env.REDIS_PASSWORD || '';
let opts = {
    redis: {
        host: redisHost,
        password
    }
};
let lockDuration = 1000 * 60 * 60 * 24;
let whisperQueue = new Queue('whispercpp', {
    ...opts,
    settings: {
        lockDuration,
        stalledInterval: 0,
    },
});
let whisperExecFile = 'whisper.cpp';
let modelFile = '/whisper.cpp/models/ggml-tiny.bin';
whisperQueue.process(async (job) => {
    let inputFile = job.data.inputFile;
    let outputFile = job.data.outputFile;
    if (!fs.existsSync(outputFile) ) {
        await whisperFile(modelFile, inputFile, outputFile, whisperExecFile);
    }
    // 
    let translated = job.data.translated;
    let outputSrt = fs.readFileSync(outputFile, 'utf8');
    let outputSrtJson = JSON.parse(outputSrt);
    let transcription = outputSrtJson.transcription;
    let correctedTranscription = correctTranscription(transcription, translated);

    return correctedTranscription;
});

// (async function(){
//     console.log('Start whispering...');
//     let inputFile = '/whisper.cpp/in.wav';

//     let djb2Str = djb2(translated.join(''));
//     let outputFile = '/whisper.cpp/output/x' + djb2Str +'.json';
//     //
//     if ( !fs.existsSync(outputFile) ) {
//         await whisperFile(modelFile, inputFile, outputFile, whisperExecFile);
//     }
//     let outputSrt = fs.readFileSync(outputFile, 'utf8');
//     // console.log(outputSrt);
//     let outputSrtJson = JSON.parse(outputSrt);
//     let transcription = outputSrtJson.transcription;
//     // console.log(transcription);
//     let correctedTranscription = correctTranscription(transcription, translated);
//     // console.log('-'.repeat(290));
//     // console.log(correctedTranscription.map((item) => { return item.text.trim(); }).join(' '));
// })();
