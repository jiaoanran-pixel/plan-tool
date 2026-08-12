// ocr_helper.m - 使用 macOS Vision 框架识别图片文字（中文+英文）
// 用法: ocr_helper <图片路径>，识别结果按从上到下、从左到右输出到 stdout。
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            fprintf(stderr, "usage: ocr_helper <image path>\n");
            return 1;
        }
        NSString *path = [NSString stringWithUTF8String:argv[1]];
        NSURL *url = [NSURL fileURLWithPath:path];

        VNRecognizeTextRequest *req =
            [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(
                VNRequest *request, NSError *error) {
                if (error) {
                    fprintf(stderr, "vision error: %s\n",
                            error.localizedDescription.UTF8String);
                    return;
                }
                NSArray *obs = request.results;
                NSArray *sorted = [obs
                    sortedArrayUsingComparator:^NSComparisonResult(
                        VNRecognizedTextObservation *a,
                        VNRecognizedTextObservation *b) {
                        CGFloat ay = CGRectGetMidY(a.boundingBox);
                        CGFloat by = CGRectGetMidY(b.boundingBox);
                        if (fabs(ay - by) > 0.02) {
                            return ay > by ? NSOrderedAscending
                                           : NSOrderedDescending;
                        }
                        return CGRectGetMinX(a.boundingBox) <
                                       CGRectGetMinX(b.boundingBox)
                                   ? NSOrderedAscending
                                   : NSOrderedDescending;
                    }];
                CGFloat lastY = 2.0;
                for (VNRecognizedTextObservation *o in sorted) {
                    VNRecognizedText *top = [[o topCandidates:1] firstObject];
                    if (!top || top.string.length == 0) continue;
                    CGFloat y = CGRectGetMidY(o.boundingBox);
                    if (fabs(y - lastY) > 0.02) printf("\n");
                    lastY = y;
                    printf("%s", top.string.UTF8String);
                    // 同一行相邻文本之间加空格，避免字被拼在一起
                    printf(" ");
                }
                printf("\n");
            }];
        req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        req.recognitionLanguages = @[ @"zh-Hans", @"en-US" ];
        req.usesLanguageCorrection = YES;
        req.minimumTextHeight = 0.005;

        NSError *err = nil;
        VNImageRequestHandler *handler =
            [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
        BOOL ok = [handler performRequests:@[ req ] error:&err];
        if (!ok) {
            fprintf(stderr, "ocr failed: %s\n",
                    (err ? err.localizedDescription.UTF8String : "unknown"));
            return 2;
        }
    }
    return 0;
}
