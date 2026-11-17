# 2026-11-15 Sign Language Recognition Research References

Compare five published camera-based sign language systems with the SignSync GRU pipeline, Live Conversation segmentation, and Recognition Lab captions. Verify technical claims against the authors’ papers and compare their evaluation protocols with the [sample training guide](scripts/SAMPLE_TRAINING.md), [Live Conversation workflow](scripts/CONTINUOUS_LIVE.md), and [[2026-11-14 FSL Lexicalization and Syntax Plan]].

## SignSync baseline

The default 43 Similar Signs Recognition Lab model classifies FSL windows resampled to 40 frames with 238 features, including normalized landmarks, handshape, and motion geometry. The seed-42 pilot used 2,671 training, 572 validation, and 573 test clips. The scaler was fitted on training data, checkpoint selection used validation loss, and the score threshold was selected using validation macro F1. The 99.13% test accuracy measures held-out clips under a split that permits signer overlap. Live Conversation uses heuristic gesture segmentation and confirmation with the P4 ensemble. Recognition Lab also has separate rules for previewing English captions from confirmed signs. [Dataset README](obsidian://open?vault=SignSync%20Dataset&file=README)

## Five references

### 1. Cardano, Columna, and Villaverde (2026) · Transactional Filipino Sign Language recognition

The Mapúa prototype prompts a signer to record three seconds of webcam video, extracts two hands’ 3D landmarks over 75 frames with MediaPipe, fills missing hand features with zeros, and uses a GRU to display one predicted sign and confidence. The custom dataset contains 1,065 videos from 20 participants, two variants per sign, and an 80/20 training versus validation/testing split. The authors report 68 correct out of 78 trials (87.18%) across 26 transactional signs and about five seconds average latency. Many errors involved similar number signs. The paper gives the closest direct comparison for the FSL landmark-to-GRU pipeline. It does not specify a signer-disjoint split, GRU layer sizes, or optimizer settings. [Engineering Proceedings](https://www.mdpi.com/2673-4591/134/1/47)

### 2. Subramanian et al. (2022) · MediaPipe and a modified GRU for Indian Sign Language

MediaPipe Holistic produces 1,662 values per frame. The classifier processes 30-frame clips with three recurrent layers of 128, 64, and 32 units. The proposed GRU couples the update and reset gates and uses ELU in the candidate state. The study recorded 30 clips for each of 13 gestures, used a 70/15/15 split, and describes 100 epochs with Adam at 0.0001 and 20% dropout. The modified model achieved 95% test accuracy versus 85% for the standard GRU in that experiment. Its comparison is relevant to SignSync’s choice of recurrent classifier. The dataset and input width differ from ours. [Scientific Reports](https://www.nature.com/articles/s41598-022-15998-7)

### 3. Samaan et al. (2022) · MediaPipe landmarks with recurrent networks

DSL10 contains 750 one-second clips of ten signs from five signers, randomly split into 450 training and 300 test clips. The authors compared GRU, LSTM, and bidirectional LSTM, each with three recurrent and three dense layers. Hand and pose inputs have 258 values per frame, rising to 1,662 with face landmarks. The GRU scored 100% in both conditions on their test split, and the paper reports longer training with face landmarks. This is a reference for comparing landmark groups under the same protocol. The random split leaves unseen-signer performance unverified. [Electronics](https://www.mdpi.com/2079-9292/11/19/3228)

### 4. Varol et al. (2022) · Sign spotting in continuous British Sign Language

The model uses an I3D video encoder and a shallow MLP to match an isolated dictionary sign to windows of continuous BSL footage and locate the best match. The authors fine-tuned the feature extractor on BSL-1K and BslDict, then trained the matching network with contrastive learning and multiple-instance supervision drawn from mouthing cues, subtitles, and dictionary examples. Their 334-class spotting benchmark reports 0.170 mean average precision. This compares with the boundary and detection problem in Live Conversation. mAP measures retrieval and localization under the paper’s protocol. [International Journal of Computer Vision](https://link.springer.com/article/10.1007/s11263-022-01589-6)

### 5. Camgöz et al. (2020) · Joint sign recognition and translation for German Sign Language

On RWTH-PHOENIX-Weather-2014T, pretrained CNN frame features feed a Transformer encoder that predicts glosses with connectionist temporal classification (CTC). CTC learns alignment from ordered gloss labels without requiring exact frame boundaries. A Transformer decoder learns to produce German text from the shared representation. The joint model uses gloss and translation targets, Adam, and development-tuned beam search. The authors report 24.49% gloss word error rate and 21.80 BLEU-4 on the test set for the joint configuration with the best recognition score. This provides a comparison for SignSync’s gloss and caption work and identifies the paired video, gloss, and text annotations needed for this approach. [CVPR paper, Sections 4–5](https://openaccess.thecvf.com/content_CVPR_2020/papers/Camgoz_Sign_Language_Transformers_Joint_End-to-End_Sign_Language_Recognition_and_Translation_CVPR_2020_paper.pdf)

The reported metrics describe different tasks, vocabularies, and data splits. Compare isolated recognition on matching clip and signer protocols, sign spotting on continuous footage with temporal references, and caption quality against reviewed translations.
